/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { type Mock } from 'vitest';
import { API } from '../AzureDBExperiences';
import { wellKnownEmulatorPassword } from '../cosmosdb/cosmosdb-shared-constants';
import { type ParsedCosmosDBConnectionString } from '../cosmosdb/cosmosDBConnectionStrings';
import { StorageService, type StorageItem } from '../services/StorageService';

// StorageService statically imports `../extensionVariables`, which transitively `require('vscode')`
// from CJS telemetry deps. The pure helpers under test don't touch storage, so stub it out.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));
vi.mock('../services/StorageService', () => ({
    StorageNames: { Workspace: 'Workspace' },
    StorageService: { get: vi.fn() },
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
        it('returns items already in the hashed format unchanged', async () => {
            const item = {
                id: 'emulator-abc123',
                name: 'NoSQL Emulator',
                properties: { api: API.Core },
            } as unknown as StorageItem;

            await expect(migrateRawEmulatorItemToHashed(item)).resolves.toBe(item);
        });

        it('masks the legacy identifiers and propagates the failure when migration fails', async () => {
            // Records from very old versions stored the connection string as the item id.
            const legacyId = 'AccountEndpoint=https://localhost:8081/;AccountKey=private-key;';
            const legacyName = 'private-name : 8081';
            const item = {
                id: legacyId,
                name: legacyName,
                properties: { api: API.Core },
            } as unknown as StorageItem;
            const context = {
                telemetry: { properties: {}, measurements: {} },
                errorHandling: {},
                valuesToMask: [] as string[],
            };

            (callWithTelemetryAndErrorHandling as Mock).mockImplementation(
                (_eventName: string, callback: (ctx: typeof context) => Promise<StorageItem>) => callback(context),
            );
            (StorageService.get as Mock).mockReturnValue({
                push: vi.fn().mockRejectedValue(new Error('storage rejected')),
                delete: vi.fn(),
            });

            await expect(migrateRawEmulatorItemToHashed(item)).rejects.toThrow();
            expect(context.valuesToMask).toContain(legacyId);
            expect(context.valuesToMask).toContain(legacyName);
            // The failure message itself must not carry the legacy id.
            await expect(migrateRawEmulatorItemToHashed(item)).rejects.not.toThrow(legacyId);
        });
    });
});
