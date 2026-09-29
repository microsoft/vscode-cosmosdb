/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { CoreExperience } from '../../AzureDBExperiences';
import { wellKnownEmulatorPassword } from '../../cosmosdb/cosmosdb-shared-constants';
import { type StorageItem } from '../../services/StorageService';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { getEmulatorItemUniqueId } from '../../utils/emulatorUtils';
import { ExecuteStep as EmulatorExecuteStep } from '../newEmulatorConnection/ExecuteStep';
import {
    NewEmulatorConnectionMode,
    type NewEmulatorConnectionWizardContext,
} from '../newEmulatorConnection/NewEmulatorConnectionWizardContext';
import { CosmosDBExecuteStep } from './CosmosDBExecuteStep';
import { type NewConnectionWizardContext } from './NewConnectionWizardContext';

const mocks = vi.hoisted(() => ({
    items: new Map<string, StorageItem>(),
    push: vi.fn<(workspace: string, item: StorageItem, overwrite?: boolean) => Promise<void>>(),
    revealWorkspaceResource: vi.fn().mockResolvedValue(undefined),
    showCreatingChild: vi.fn(async (_parentId: string, _label: string, action: () => Promise<void>) => action()),
}));

vi.mock('@microsoft/vscode-azext-utils', () => ({
    AzureWizardExecuteStep: class {},
    callWithTelemetryAndErrorHandling: vi.fn(),
}));
vi.mock('../../extensionVariables', () => ({
    ext: {
        state: { showCreatingChild: mocks.showCreatingChild },
        rgApiV2: { resources: { revealWorkspaceResource: mocks.revealWorkspaceResource } },
    },
}));
vi.mock('../../services/StorageService', () => ({
    StorageNames: { Workspace: 'Workspace' },
    StorageService: { get: () => ({ push: mocks.push }) },
}));

const parentId = WorkspaceResourceType.AttachedAccounts;
const connectionString = `AccountEndpoint=https://localhost:8081/;AccountKey=${wellKnownEmulatorPassword};`;

function contextFor(value: string, tenantId?: string): NewConnectionWizardContext {
    // The execution step does not use the wizard's UI or action-context services.
    return { parentId, connectionString: value, tenantId } as NewConnectionWizardContext;
}

async function execute(context: NewConnectionWizardContext): Promise<void> {
    const pending = new CosmosDBExecuteStep().execute(context);
    await vi.runAllTimersAsync();
    await pending;
}

describe('CosmosDBExecuteStep', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        mocks.items.clear();
        mocks.push.mockImplementation(async (_workspace, item) => {
            mocks.items.set(item.id, item);
        });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        ['localhost', wellKnownEmulatorPassword],
        ['127.0.0.1', wellKnownEmulatorPassword],
        ['[::1]', wellKnownEmulatorPassword],
        ['remote-emulator.example.com', wellKnownEmulatorPassword],
        ['localhost', 'custom-emulator-key'],
    ])('stores %s as an emulator when recognized by the existing classifier', async (host, key) => {
        const value = `AccountEndpoint=https://${host}:8081/;AccountKey=${key};`;

        await execute(contextFor(value));

        expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
            parentId,
            {
                id: getEmulatorItemUniqueId(value),
                name: 'NoSQL Emulator : 8081',
                properties: { isEmulator: true, api: CoreExperience.api },
                secrets: [value],
            },
            true,
        );
        expect(mocks.showCreatingChild).toHaveBeenCalledWith(
            `${parentId}/localEmulators`,
            expect.any(String),
            expect.any(Function),
        );
        expect(mocks.revealWorkspaceResource.mock.calls).toEqual([
            [parentId, { select: true, focus: true, expand: true }],
            [`${parentId}/localEmulators`, { select: true, focus: true, expand: true }],
        ]);
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith('azureWorkspace.focus');
        expect(mocks.revealWorkspaceResource.mock.invocationCallOrder[1]).toBeLessThan(
            mocks.showCreatingChild.mock.invocationCallOrder[0],
        );
    });

    it('propagates expansion errors without storing a connection', async () => {
        const error = new Error('Unable to reveal Local Emulators');
        mocks.revealWorkspaceResource.mockResolvedValueOnce(undefined).mockRejectedValueOnce(error);

        await expect(new CosmosDBExecuteStep().execute(contextFor(connectionString))).rejects.toBe(error);

        expect(mocks.push).not.toHaveBeenCalled();
        expect(mocks.showCreatingChild).not.toHaveBeenCalled();
    });

    it('preserves emulator classification after copying, detaching, and reattaching through New Connection', async () => {
        const emulatorContext = {
            parentTreeElementId: `${parentId}/localEmulators`,
            connectionString,
            port: 8081,
            experience: CoreExperience,
            mode: NewEmulatorConnectionMode.Preconfigured,
        } as NewEmulatorConnectionWizardContext;
        const pending = new EmulatorExecuteStep().execute(emulatorContext);
        await vi.runAllTimersAsync();
        await pending;

        expect(mocks.revealWorkspaceResource.mock.calls).toEqual([
            [parentId, { select: true, focus: true, expand: true }],
            [`${parentId}/localEmulators`, { select: true, focus: true, expand: true }],
        ]);
        expect(mocks.revealWorkspaceResource.mock.invocationCallOrder[1]).toBeLessThan(
            mocks.showCreatingChild.mock.invocationCallOrder[0],
        );

        const id = getEmulatorItemUniqueId(connectionString);
        const original = mocks.items.get(id)!;
        const copiedConnectionString = original.secrets![0];
        mocks.items.delete(id);
        expect(mocks.items.size).toBe(0);

        await execute(contextFor(copiedConnectionString));

        expect(mocks.items.size).toBe(1);
        expect(mocks.items.get(id)).toEqual(original);
    });

    it.each([
        ['AccountKey=cloud-key;', undefined, undefined],
        ['', 'selected-tenant', 'selected-tenant'],
        ['TenantId=connection-tenant;', undefined, 'connection-tenant'],
        ['TenantId=connection-tenant;', 'selected-tenant', 'selected-tenant'],
    ])('preserves normal account storage and tenant selection (%s)', async (suffix, tenantId, expectedTenant) => {
        const value = `AccountEndpoint=https://account.documents.azure.com/;${suffix}`;

        await execute(contextFor(value, tenantId));

        expect(mocks.push).toHaveBeenCalledExactlyOnceWith(
            parentId,
            {
                id: 'account.documents.azure.com:443',
                name: 'account.documents.azure.com:443 (NoSQL)',
                properties: {
                    isEmulator: false,
                    api: CoreExperience.api,
                    ...(expectedTenant && { tenantId: expectedTenant }),
                },
                secrets: [value],
            },
            true,
        );
        expect(mocks.showCreatingChild).toHaveBeenCalledWith(parentId, expect.any(String), expect.any(Function));
        expect(mocks.revealWorkspaceResource).toHaveBeenCalledExactlyOnceWith(parentId, {
            select: true,
            focus: true,
            expand: true,
        });
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith('azureWorkspace.focus');
        expect(mocks.revealWorkspaceResource.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.showCreatingChild.mock.invocationCallOrder[0],
        );
    });
});
