/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { API } from '../AzureDBExperiences';
import { createArmTestContext } from '../cosmosdb/armTestUtils';
import { wellKnownEmulatorPassword } from '../cosmosdb/cosmosdb-shared-constants';
import { type ParsedCosmosDBConnectionString } from '../cosmosdb/cosmosDBConnectionStrings';
import { StorageNames, StorageService, type StorageItem } from '../services/StorageService';
import { WorkspaceResourceType } from '../tree/workspace-api/SharedWorkspaceResourceProvider';

const io = vi.hoisted(() => ({
    getState: vi.fn(),
    updateState: vi.fn(),
    keys: vi.fn(),
    getSecret: vi.fn(),
    storeSecret: vi.fn(),
    deleteSecret: vi.fn(),
}));

// Stub the host dependencies so we can observe the error sent to the telemetry and display boundary.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));
vi.mock('./azureClients', () => ({}));
vi.mock('../extensionVariables', () => ({
    ext: {
        context: {
            extension: { id: 'test-extension' },
            globalState: { get: io.getState, update: io.updateState, keys: io.keys },
        },
        secretStorage: { get: io.getSecret, store: io.storeSecret, delete: io.deleteSecret },
    },
}));

import {
    getEmulatorItemLabelForApi,
    getEmulatorItemUniqueId,
    getIsEmulatorConnection,
    migrateRawEmulatorItemToHashed,
} from './emulatorUtils';

describe('emulatorUtils', () => {
    describe('getEmulatorItemUniqueId', () => {
        it('prefixes the id with "emulator-"', () => {
            expect(getEmulatorItemUniqueId('some-connection-string').startsWith('emulator-')).toBe(true);
        });

        it('produces a 24-char hex hash suffix', () => {
            const id = getEmulatorItemUniqueId('some-connection-string');
            const suffix = id.slice('emulator-'.length);
            expect(suffix).toHaveLength(24);
            expect(suffix).toMatch(/^[0-9a-f]{24}$/);
        });

        it('is deterministic for the same input', () => {
            expect(getEmulatorItemUniqueId('abc')).toBe(getEmulatorItemUniqueId('abc'));
        });

        it('produces different ids for different inputs', () => {
            expect(getEmulatorItemUniqueId('abc')).not.toBe(getEmulatorItemUniqueId('def'));
        });
    });

    describe('getEmulatorItemLabelForApi', () => {
        it('builds a label without a port suffix when port is undefined', () => {
            expect(getEmulatorItemLabelForApi(API.Core, undefined)).toBe('NoSQL Emulator');
        });

        it('appends the port when provided as a number', () => {
            expect(getEmulatorItemLabelForApi(API.Core, 8081)).toBe('NoSQL Emulator : 8081');
        });

        it('appends the port when provided as a string', () => {
            expect(getEmulatorItemLabelForApi(API.Core, '10255')).toBe('NoSQL Emulator : 10255');
        });
    });

    describe('getIsEmulatorConnection', () => {
        it('returns true when the master key is the well-known emulator password', () => {
            const cs = { masterKey: wellKnownEmulatorPassword, hostName: 'example.com' };
            expect(getIsEmulatorConnection(cs as ParsedCosmosDBConnectionString)).toBe(true);
        });

        it('returns true when the host name is localhost', () => {
            const cs = { masterKey: 'other', hostName: 'localhost' };
            expect(getIsEmulatorConnection(cs as ParsedCosmosDBConnectionString)).toBe(true);
        });

        it('returns false for a regular connection string', () => {
            const cs = { masterKey: 'other', hostName: 'myaccount.documents.azure.com' };
            expect(getIsEmulatorConnection(cs as ParsedCosmosDBConnectionString)).toBe(false);
        });
    });

    describe('migrateRawEmulatorItemToHashed', () => {
        const connectionString = 'AccountEndpoint=https://localhost:8081/;AccountKey=legacy-test-key;';
        const oldItemKey = `test-extension.workspace/${WorkspaceResourceType.AttachedAccounts}/${connectionString}`;
        const item: StorageItem = { id: connectionString, name: 'NoSQL Emulator', properties: { api: API.Core } };

        beforeEach(() => vi.resetAllMocks());
        afterEach(() => vi.restoreAllMocks());

        it('returns items already in the hashed format unchanged', async () => {
            const item = {
                id: 'emulator-abc123',
                name: 'NoSQL Emulator',
                properties: { api: API.Core },
            } as unknown as StorageItem;

            await expect(migrateRawEmulatorItemToHashed(item)).resolves.toBe(item);
        });

        it('does not log the legacy ID or malformed secret payload when enumerating saved items', async () => {
            io.keys.mockReturnValue([oldItemKey]);
            io.getState.mockReturnValue({ ...item });
            io.getSecret.mockResolvedValue('legacy-test-key is not valid JSON');
            const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

            const storage = StorageService.get(StorageNames.Workspace);
            const items = await storage.getItems(WorkspaceResourceType.AttachedAccounts);
            expect(items).toEqual([{ ...item, secrets: [] }]);
            expect(log).toHaveBeenCalledExactlyOnceWith('Could not parse saved connection secrets.');
        });

        it.each(['store', 'delete'] as const)(
            'does not expose legacy credentials when storage %s fails',
            async (step) => {
                const context = createArmTestContext();
                const error = vi.fn();
                const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
                io.getState.mockImplementation((key) => (key === oldItemKey ? item : undefined));
                io.deleteSecret.mockRejectedValue(new Error('Storage failure mentioning legacy-test-key'));
                vi.mocked(callWithTelemetryAndErrorHandling).mockImplementation(async (_event, action) => {
                    try {
                        return await action(context);
                    } catch (cause) {
                        error(cause);
                        throw cause;
                    }
                });
                let masksAtWrite: string[] = [];
                let maskErrorAtWrite: boolean | undefined;
                io.storeSecret.mockImplementationOnce(async () => {
                    masksAtWrite = [...context.valuesToMask];
                    maskErrorAtWrite = context.telemetry.maskEntireErrorMessage;
                    if (step === 'store') throw new Error(`Storage failure mentioning ${connectionString}`);
                });

                await expect(migrateRawEmulatorItemToHashed(item)).resolves.toBe(item);
                expect(masksAtWrite).toContain(connectionString);
                expect(maskErrorAtWrite).toBe(true);
                expect(io.storeSecret).toHaveBeenCalledOnce();
                expect(io.deleteSecret).toHaveBeenCalledTimes(step === 'delete' ? 1 : 0);
                expect(error).toHaveBeenCalledExactlyOnceWith(new Error('Could not update saved emulator storage.'));
                expect(error.mock.calls[0][0]).not.toHaveProperty('cause');
                expect(log).not.toHaveBeenCalled();
            },
        );
    });
});
