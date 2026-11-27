/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UserCancelledError } from '@microsoft/vscode-azext-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { validateContainerNameAvailable } from '../createContainer/CosmosDBContainerNameStep';
import { promptContainerNameOrDataModeler } from '../createContainer/promptContainerNameOrDataModeler';
import { validateDatabaseNameAvailable } from './CosmosDBDatabaseNameStep';
import { promptDatabaseNameOrDataModeler } from './promptDatabaseNameOrDataModeler';

vi.mock('@vscode/extension-telemetry', () => ({ default: class {} }));
vi.mock('@microsoft/vscode-azureresources-api', () => ({}));
vi.mock('./CosmosDBDatabaseNameStep', () => ({ validateDatabaseNameAvailable: vi.fn() }));
vi.mock('../createContainer/CosmosDBContainerNameStep', () => ({ validateContainerNameAvailable: vi.fn() }));

type Item = vscode.QuickPickItem & { action?: string };

class FakeQuickPick {
    public value = '';
    public items: readonly Item[] = [];
    public activeItems: readonly Item[] = [];
    public busy = false;
    public enabled = true;
    public title?: string;
    public placeholder?: string;
    public ignoreFocusOut = false;
    public readonly show = vi.fn();
    public readonly dispose = vi.fn(() => this.fire('hide'));
    private readonly listeners = new Map<string, Array<(value?: unknown) => unknown>>();

    public onDidChangeValue = this.on('value');
    public onDidAccept = this.on('accept');
    public onDidHide = this.on('hide');

    public type(value: string): void {
        this.value = value;
        void this.fire('value', value);
    }

    public async accept(action?: string): Promise<void> {
        if (action) {
            this.activeItems = this.items.filter((item) => item.action === action);
        }
        await this.fire('accept');
    }

    public hide(): void {
        void this.fire('hide');
    }

    public get createItem(): Item {
        return this.items[0];
    }

    private on(event: string) {
        return (listener: (value?: unknown) => unknown) => {
            const listeners = this.listeners.get(event) ?? [];
            listeners.push(listener);
            this.listeners.set(event, listeners);
            return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
        };
    }

    private async fire(event: string, value?: unknown): Promise<void> {
        await Promise.all([...(this.listeners.get(event) ?? [])].map((listener) => listener(value)));
    }
}

const accountInfo = { id: 'account-id', name: 'account' } as AccountInfo;
let quickPick: FakeQuickPick;

beforeEach(() => {
    quickPick = new FakeQuickPick();
    vi.mocked(vscode.window.createQuickPick).mockReturnValue(quickPick as unknown as vscode.QuickPick<Item>);
    vi.mocked(validateDatabaseNameAvailable).mockReset().mockResolvedValue(undefined);
    vi.mocked(validateContainerNameAvailable).mockReset().mockResolvedValue(undefined);
});

describe('container name and Data Modeler prompt', () => {
    it('validates container names in the selected database and restores Data Modeler only when cleared', async () => {
        const choice = promptContainerNameOrDataModeler(accountInfo, 'selected-db');
        expect(quickPick.title).toBe('Create container');
        expect(quickPick.placeholder).toBe('Enter a container name for selected-db');
        expect(quickPick.items[2].label).toBe('Try Data Modeler');
        quickPick.type('bad/name');
        await quickPick.accept();
        expect(quickPick.createItem.detail).toContain('Container name cannot contain');
        expect(validateContainerNameAvailable).not.toHaveBeenCalled();
        vi.mocked(validateContainerNameAvailable).mockResolvedValueOnce('Already exists');
        quickPick.type('orders');
        await quickPick.accept();
        expect(validateContainerNameAvailable).toHaveBeenCalledExactlyOnceWith(accountInfo, 'selected-db', 'orders');
        expect(quickPick.items).toHaveLength(1);
        expect(quickPick.createItem.detail).toBe('Already exists');
        quickPick.type('');
        expect(quickPick.items[2].label).toBe('Try Data Modeler');
        await quickPick.accept('dataModeler');
        await expect(choice).resolves.toEqual({ kind: 'dataModeler' });
    });

    it('accepts a trimmed container name with the Enter/Escape hint', async () => {
        const choice = promptContainerNameOrDataModeler(accountInfo, 'selected-db');
        quickPick.type('  orders  ');
        expect(quickPick.createItem.description).toBe(
            `Create container "orders" (Press 'Enter' to confirm or 'Escape' to cancel)`,
        );
        await quickPick.accept();
        await expect(choice).resolves.toEqual({ kind: 'manual', name: 'orders' });
    });
});

describe('promptDatabaseNameOrDataModeler', () => {
    it('shows the create item first and Data Modeler below a separator', async () => {
        const choice = promptDatabaseNameOrDataModeler(accountInfo);

        expect(quickPick.show).toHaveBeenCalledOnce();
        expect(quickPick.items.map((item) => [item.label, item.description, item.kind, item.alwaysShow])).toEqual([
            ['Create database', undefined, undefined, true],
            ['', undefined, vscode.QuickPickItemKind.Separator, undefined],
            ['Try Data Modeler', undefined, undefined, true],
        ]);
        expect(quickPick.items[2].detail).toBe('Model your workload and get partition key recommendations.');
        expect(quickPick.activeItems).toEqual([quickPick.createItem]);
        quickPick.hide();
        await expect(choice).rejects.toBeInstanceOf(UserCancelledError);
    });

    it('returns the trimmed typed name after checking availability', async () => {
        const choice = promptDatabaseNameOrDataModeler(accountInfo);
        quickPick.type('  orders  ');
        expect(quickPick.items).toEqual([quickPick.createItem]);
        expect(quickPick.createItem).toMatchObject({
            label: '',
            description: `Create database "orders" (Press 'Enter' to confirm or 'Escape' to cancel)`,
        });
        expect(quickPick.activeItems).toEqual([quickPick.createItem]);

        await quickPick.accept();

        await expect(choice).resolves.toEqual({ kind: 'manual', databaseName: 'orders' });
        expect(validateDatabaseNameAvailable).toHaveBeenCalledExactlyOnceWith(accountInfo, 'orders');
        expect(quickPick.dispose).toHaveBeenCalledOnce();
    });

    it('hides Data Modeler while a name is typed and restores it when the name is cleared', async () => {
        const choice = promptDatabaseNameOrDataModeler(accountInfo);
        quickPick.type('orders');
        expect(quickPick.items.map((item) => item.label)).toEqual(['']);

        quickPick.type('  ');
        expect(quickPick.items.map((item) => item.label)).toEqual(['Create database', '', 'Try Data Modeler']);
        await quickPick.accept('dataModeler');

        await expect(choice).resolves.toEqual({ kind: 'dataModeler' });
        expect(validateDatabaseNameAvailable).not.toHaveBeenCalled();
    });

    it('shows invalid names on the create item and stays open', async () => {
        let settled = false;
        const choice = promptDatabaseNameOrDataModeler(accountInfo);
        choice.finally(() => (settled = true)).catch(() => undefined);
        quickPick.type('bad/name');
        expect(quickPick.createItem.detail).toBe(
            "Database name cannot contain the characters '\\', '/', '#', '?', '='",
        );

        await quickPick.accept();
        quickPick.type('');
        await quickPick.accept();

        expect(quickPick.createItem.detail).toBe('Database name is required.');
        expect(validateDatabaseNameAvailable).not.toHaveBeenCalled();
        expect(settled).toBe(false);
        quickPick.hide();
        await expect(choice).rejects.toBeInstanceOf(UserCancelledError);
    });

    it('shows an existing-name error and allows correcting it', async () => {
        vi.mocked(validateDatabaseNameAvailable).mockResolvedValueOnce('The database "orders" already exists.');
        const choice = promptDatabaseNameOrDataModeler(accountInfo);
        quickPick.type('orders');

        await quickPick.accept();
        expect(quickPick.createItem.detail).toBe('The database "orders" already exists.');
        expect(quickPick).toMatchObject({ busy: false, enabled: true });

        quickPick.type('orders-2');
        await quickPick.accept();
        await expect(choice).resolves.toEqual({ kind: 'manual', databaseName: 'orders-2' });
    });

    it('cancels when hidden', async () => {
        const choice = promptDatabaseNameOrDataModeler(accountInfo);
        quickPick.hide();
        await expect(choice).rejects.toBeInstanceOf(UserCancelledError);
    });
});
