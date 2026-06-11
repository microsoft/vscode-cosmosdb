/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';

// The module statically imports the vscode-azext-utils barrel and a heavy picker helper;
// neither is exercised by the pure `isNoSqlQueryConnection` guard, so stub them out.
vi.mock('@microsoft/vscode-azext-utils', () => ({
    callWithTelemetryAndErrorHandling: vi.fn(),
}));
vi.mock('@microsoft/vscode-azureresources-api', () => ({
    AzExtResourceType: { AzureCosmosDb: 'AzureCosmosDb' },
}));
vi.mock('../utils/pickItem/pickAppResource', () => ({
    pickAppResource: vi.fn(),
}));

import { isNoSqlQueryConnection } from './NoSqlQueryConnection';

function validConnection(): unknown {
    return {
        databaseId: 'db',
        containerId: 'c',
        endpoint: 'https://example.documents.azure.com',
        credentials: [],
        isEmulator: false,
    };
}

describe('isNoSqlQueryConnection', () => {
    it('accepts a fully-formed connection object', () => {
        expect(isNoSqlQueryConnection(validConnection())).toBe(true);
    });

    it('accepts a connection that also carries optional azureMetadata', () => {
        expect(isNoSqlQueryConnection({ ...(validConnection() as object), azureMetadata: {} })).toBe(true);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['a string', 'connection'],
        ['a number', 42],
        ['an empty object', {}],
    ])('rejects %s', (_label, value) => {
        expect(isNoSqlQueryConnection(value)).toBe(false);
    });

    it('rejects when a required field is missing', () => {
        const { databaseId, ...withoutDatabaseId } = validConnection() as Record<string, unknown>;
        void databaseId;
        expect(isNoSqlQueryConnection(withoutDatabaseId)).toBe(false);
    });

    it('rejects when a required field has the wrong type', () => {
        expect(isNoSqlQueryConnection({ ...(validConnection() as object), isEmulator: 'false' })).toBe(false);
        expect(isNoSqlQueryConnection({ ...(validConnection() as object), credentials: 'none' })).toBe(false);
        expect(isNoSqlQueryConnection({ ...(validConnection() as object), containerId: 123 })).toBe(false);
    });
});
