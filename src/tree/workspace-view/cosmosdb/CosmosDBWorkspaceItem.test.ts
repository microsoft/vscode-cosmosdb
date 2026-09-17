/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { vi } from 'vitest';
import { API } from '../../../AzureDBExperiences';
import { type StorageItem } from '../../../services/StorageService';
import { CosmosDBWorkspaceItem } from './CosmosDBWorkspaceItem';
import { getSavedConnectionError, InvalidConnectionResourceItem } from './InvalidConnectionResourceItem';
import { LocalCoreEmulatorsItem } from './LocalEmulators/LocalCoreEmulatorsItem';

const { getItems, migrate, logError } = vi.hoisted(() => ({
    getItems: vi.fn<() => Promise<StorageItem[]>>(),
    migrate: vi.fn<(item: StorageItem) => Promise<StorageItem>>(),
    logError: vi.fn(),
}));

vi.mock('../../../extensionVariables', () => ({ ext: { outputChannel: { error: logError } } }));
vi.mock('../../../services/StorageService', () => ({
    StorageNames: { Workspace: 'workspace' },
    StorageService: { get: () => ({ getItems }) },
}));
vi.mock('../../../constants', () => ({ isEmulatorSupported: true, getThemeAgnosticIconPath: vi.fn() }));
vi.mock('../../../utils/emulatorUtils', () => ({ migrateRawEmulatorItemToHashed: migrate }));
vi.mock('../../workspace-api/SharedWorkspaceResourceProvider', () => ({
    WorkspaceResourceType: { AttachedAccounts: 'accounts' },
}));
vi.mock('../../mixins/Filterable', () => ({ makeFilterable: (item: unknown) => item }));
vi.mock('../../mixins/Sortable', () => ({ makeSortable: (item: unknown) => item }));
vi.mock('../../nosql/NoSqlAccountAttachedResourceItem', () => ({
    NoSqlAccountAttachedResourceItem: class {
        public readonly id: string;
        constructor(public readonly account: { id: string; name: string; connectionString: string }) {
            this.id = account.id;
        }
        getTreeItem() {
            return { label: this.account.name };
        }
    },
}));
vi.mock('../../cosmosdb/CosmosDBAccountUnsupportedResourceItem', () => ({
    CosmosDBAccountUnsupportedResourceItem: class {},
}));
vi.mock('./CosmosDBAttachAccountResourceItem', () => ({ CosmosDBAttachAccountResourceItem: class {} }));
vi.mock('./LocalEmulators/NewCoreEmulatorConnectionItem', () => ({ NewCoreEmulatorConnectionItem: class {} }));

const makeItem = (id: string, isEmulator = false): StorageItem => ({
    id,
    name: id,
    properties: { api: API.Core, isEmulator },
    secrets: ['private-connection-string'],
});

describe('saved connection resilience', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        migrate.mockImplementation(async (item) => item);
    });

    it.each<{ label: string; properties: NonNullable<StorageItem['properties']>; secrets: string[] }>([
        { label: 'missing API', properties: { isEmulator: false }, secrets: ['private-secret'] },
        { label: 'blank API', properties: { api: ' ', isEmulator: false }, secrets: ['private-secret'] },
        { label: 'missing emulator flag', properties: { api: API.Core }, secrets: ['private-secret'] },
        {
            label: 'non-boolean emulator flag',
            properties: { api: API.Core, isEmulator: 'true' },
            secrets: ['private-secret'],
        },
        { label: 'missing secret', properties: { api: API.Core, isEmulator: false }, secrets: [] },
        { label: 'empty secret', properties: { api: API.Core, isEmulator: false }, secrets: [' '] },
    ])('keeps valid siblings and a removable entry for $label', async ({ properties, secrets }) => {
        const invalid: StorageItem = { id: 'broken', name: 'Broken', properties, secrets };
        getItems.mockResolvedValue([makeItem('before'), invalid, makeItem('after')]);

        const children = await new CosmosDBWorkspaceItem().getChildren();
        expect(children.map((child) => child.id)).toContain('accounts/before');
        expect(children.map((child) => child.id)).toContain('accounts/after');
        const errorNode = children.find((child) => child instanceof InvalidConnectionResourceItem);
        expect(errorNode).toBeDefined();
        expect(errorNode?.storageId).toBe('broken');
        expect(errorNode?.experience.api).toBe(API.Common);
        expect(errorNode?.getTreeItem()).toMatchObject({
            description: 'Invalid saved connection',
            contextValue: 'treeItem.invalidConnection',
        });
        // Removal stays an explicit context-menu action; clicking the node must not start a destructive flow.
        expect(errorNode?.getTreeItem().command).toBeUndefined();
        expect(logError).toHaveBeenCalledOnce();
        expect(JSON.stringify(logError.mock.calls)).not.toContain('private-');
        expect(JSON.stringify(errorNode?.getTreeItem().tooltip)).not.toContain('private-');
    });

    it('silently skips well-formed connections owned by another experience', async () => {
        const unsupported: StorageItem = {
            id: 'mongo',
            name: 'Legacy Mongo',
            properties: { api: 'MongoDB', isEmulator: false },
            secrets: ['private-connection-string'],
        };
        getItems.mockResolvedValue([makeItem('before'), unsupported, makeItem('after')]);

        const children = await new CosmosDBWorkspaceItem().getChildren();
        expect(children.some((child) => child instanceof InvalidConnectionResourceItem)).toBe(false);
        expect(children.map((child) => child.id)).toContain('accounts/before');
        expect(children.map((child) => child.id)).toContain('accounts/after');
        expect(logError).not.toHaveBeenCalled();
    });

    it('isolates invalid emulator metadata before migration', async () => {
        const invalid = makeItem('broken', true);
        invalid.properties = { isEmulator: true };
        getItems.mockResolvedValue([makeItem('before', true), invalid, makeItem('after', true)]);
        const children = await new LocalCoreEmulatorsItem('accounts').getChildren();
        expect(children.map((child) => child.id)).toEqual([
            'accounts/localEmulators/before',
            'accounts/localEmulators/broken',
            'accounts/localEmulators/after',
            undefined,
        ]);
        expect(migrate).toHaveBeenCalledTimes(2);
        expect(children[1]).toBeInstanceOf(InvalidConnectionResourceItem);
    });

    it('preserves the emulator connection-string fallback', async () => {
        const emulator = makeItem('emulator', true);
        delete emulator.secrets;
        getItems.mockResolvedValue([emulator]);
        const children = await new LocalCoreEmulatorsItem('accounts').getChildren();
        expect(children[0]).toMatchObject({
            account: { connectionString: expect.stringContaining('AccountEndpoint=https://localhost:8081/') },
        });
        expect(logError).not.toHaveBeenCalled();
    });

    it('isolates unexpected per-emulator failures without logging raw errors', async () => {
        const broken = makeItem('broken', true);
        migrate.mockImplementation(async (item) => {
            if (item === broken) throw new Error('private-connection-string');
            return item;
        });
        getItems.mockResolvedValue([broken, makeItem('valid', true)]);
        const children = await new LocalCoreEmulatorsItem('accounts').getChildren();
        expect(children[0]).toBeInstanceOf(InvalidConnectionResourceItem);
        expect(children[1].id).toBe('accounts/localEmulators/valid');
        expect(JSON.stringify(logError.mock.calls)).not.toContain('private-connection-string');
    });

    it('accepts valid attached connections and legacy emulator secrets', () => {
        expect(getSavedConnectionError(makeItem('valid'))).toBeUndefined();
        const emulator = makeItem('emulator', true);
        delete emulator.secrets;
        expect(getSavedConnectionError(emulator)).toBeUndefined();
    });
});
