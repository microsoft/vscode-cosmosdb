/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type CosmosDBRecordIdentifier } from '../cosmosdb/types/queryResult';
import { isSameDocumentTab } from './documentTabIdentity';

const makeConnection = (overrides: Partial<NoSqlQueryConnection> = {}): NoSqlQueryConnection => ({
    databaseId: 'database-a',
    containerId: 'container-a',
    endpoint: 'https://account-a.documents.azure.com',
    credentials: [],
    isEmulator: false,
    ...overrides,
});

const document: CosmosDBRecordIdentifier = {
    id: 'shared-id',
    partitionKey: ['tenant', 42],
    _rid: 'shared-rid',
};

describe('isSameDocumentTab', () => {
    it.each([
        ['endpoint', { endpoint: 'https://account-b.documents.azure.com' }],
        ['database', { databaseId: 'database-b' }],
        ['container', { containerId: 'container-b' }],
    ])('does not match the same item from a different %s', (_label, connectionOverrides) => {
        expect(isSameDocumentTab(makeConnection(), document, makeConnection(connectionOverrides), document)).toBe(
            false,
        );
    });

    it('matches the same resource ID within the same container', () => {
        expect(isSameDocumentTab(makeConnection(), document, makeConnection(), document)).toBe(true);
    });

    it('does not match different resource IDs within the same container', () => {
        expect(
            isSameDocumentTab(makeConnection(), document, makeConnection(), { ...document, _rid: 'other-rid' }),
        ).toBe(false);
    });

    it('matches equal IDs and structurally equal partition keys when resource IDs are unavailable', () => {
        const first = { id: 'shared-id', partitionKey: ['tenant', 42, true] };
        const second = { id: 'shared-id', partitionKey: ['tenant', 42, true] };

        expect(isSameDocumentTab(makeConnection(), first, makeConnection(), second)).toBe(true);
    });

    it('does not collapse distinct hierarchical partition keys containing commas', () => {
        const first = { id: 'shared-id', partitionKey: ['a,b', 'c'] };
        const second = { id: 'shared-id', partitionKey: ['a', 'b,c'] };

        expect(isSameDocumentTab(makeConnection(), first, makeConnection(), second)).toBe(false);
    });

    it('preserves partition key value types', () => {
        const first = { id: 'shared-id', partitionKey: ['42'] };
        const second = { id: 'shared-id', partitionKey: [42] };

        expect(isSameDocumentTab(makeConnection(), first, makeConnection(), second)).toBe(false);
    });

    it('does not match when only one identifier has a partition key', () => {
        const first = { id: 'shared-id', partitionKey: 'tenant' };
        const second = { id: 'shared-id' };

        expect(isSameDocumentTab(makeConnection(), first, makeConnection(), second)).toBe(false);
    });
});
