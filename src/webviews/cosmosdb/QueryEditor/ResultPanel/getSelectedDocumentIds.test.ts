/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition, PartitionKeyDefinitionVersion } from '@azure/cosmos';
import { type QueryResultRecord, type SerializedQueryResult } from '../../../../cosmosdb/types/queryResult';
import { getSelectedDocumentIds } from './getSelectedDocumentIds';

const makeQueryResult = (documents: QueryResultRecord[]): SerializedQueryResult => ({
    activityId: 'activity-1',
    documents,
    iteration: 1,
    metadata: {},
    indexMetrics: '',
    requestCharge: 0,
    roundTrips: 1,
    hasMoreResults: false,
    query: 'SELECT * FROM c',
});

const partitionKeyDef: PartitionKeyDefinition = {
    paths: ['/pk'],
    version: PartitionKeyDefinitionVersion.V2,
};

describe('getSelectedDocumentIds', () => {
    describe('empty / nullish inputs', () => {
        it('returns [] when no rows are selected', () => {
            const queryResult = makeQueryResult([{ id: '1', _rid: 'r1' }]);

            expect(getSelectedDocumentIds([], queryResult, undefined)).toEqual([]);
        });

        it('returns [] when the query result is null', () => {
            expect(getSelectedDocumentIds([0, 1], null, undefined)).toEqual([]);
        });

        it('drops out-of-range indices', () => {
            const queryResult = makeQueryResult([{ id: '1', _rid: 'r1' }]);

            // Index 5 does not exist; index 0 does.
            expect(getSelectedDocumentIds([5], queryResult, undefined)).toEqual([]);
        });

        it('drops null and undefined document entries', () => {
            const queryResult = makeQueryResult([null, { id: '1', _rid: 'r1' }]);

            const result = getSelectedDocumentIds([0, 1], queryResult, undefined);

            expect(result).toEqual([{ _rid: 'r1', id: '1', partitionKey: undefined }]);
        });

        it('drops documents that have neither _rid nor id', () => {
            const queryResult = makeQueryResult([{ name: 'no-identity' }]);

            expect(getSelectedDocumentIds([0], queryResult, undefined)).toEqual([]);
        });
    });

    describe('identity resolution', () => {
        it('resolves a document by _rid (no partition key)', () => {
            const queryResult = makeQueryResult([{ id: 'a', _rid: 'rid-a' }]);

            expect(getSelectedDocumentIds([0], queryResult, undefined)).toEqual([
                { _rid: 'rid-a', id: 'a', partitionKey: undefined },
            ]);
        });

        it('resolves a document by id + partition key when _rid is absent', () => {
            const queryResult = makeQueryResult([{ id: 'a', pk: 'tenant-1' }]);

            expect(getSelectedDocumentIds([0], queryResult, partitionKeyDef)).toEqual([
                { _rid: undefined, id: 'a', partitionKey: ['tenant-1'] },
            ]);
        });

        it('extracts the partition key value alongside the identifier', () => {
            const queryResult = makeQueryResult([{ id: 'a', _rid: 'rid-a', pk: 'tenant-1' }]);

            expect(getSelectedDocumentIds([0], queryResult, partitionKeyDef)).toEqual([
                { _rid: 'rid-a', id: 'a', partitionKey: ['tenant-1'] },
            ]);
        });
    });

    describe('lenient guard (regression: Edit/View/Delete must not be no-op)', () => {
        // A full CosmosDBRecord requires id, _rid, _ts, _self, _etag AND _attachments.
        // Real query results often omit some of these (e.g. _attachments). The old strict
        // isCosmosDBRecord pre-check dropped such rows, making the buttons/hotkeys do nothing
        // while double-click (which uses the lenient __documentId) still worked.

        it('resolves a row missing _attachments / _ts / _self / _etag (had _rid)', () => {
            const queryResult = makeQueryResult([{ id: 'a', _rid: 'rid-a' /* no _ts/_self/_etag/_attachments */ }]);

            expect(getSelectedDocumentIds([0], queryResult, undefined)).toEqual([
                { _rid: 'rid-a', id: 'a', partitionKey: undefined },
            ]);
        });

        it('resolves a projection-style row that only has id + partition key', () => {
            // e.g. SELECT c.id, c.pk FROM c — no system fields at all.
            const queryResult = makeQueryResult([{ id: 'a', pk: 'tenant-1' }]);

            expect(getSelectedDocumentIds([0], queryResult, partitionKeyDef)).toEqual([
                { _rid: undefined, id: 'a', partitionKey: ['tenant-1'] },
            ]);
        });
    });

    describe('multiple rows', () => {
        it('preserves selection order and maps indices 1:1 to documents', () => {
            const queryResult = makeQueryResult([
                { id: 'a', _rid: 'rid-a' },
                { id: 'b', _rid: 'rid-b' },
                { id: 'c', _rid: 'rid-c' },
            ]);

            const result = getSelectedDocumentIds([2, 0], queryResult, undefined);

            expect(result).toEqual([
                { _rid: 'rid-c', id: 'c', partitionKey: undefined },
                { _rid: 'rid-a', id: 'a', partitionKey: undefined },
            ]);
        });

        it('keeps resolvable rows and drops unresolvable ones in a mixed selection', () => {
            const queryResult = makeQueryResult([
                { id: 'a', _rid: 'rid-a' },
                { name: 'no-identity' },
                { id: 'c', _rid: 'rid-c' },
            ]);

            const result = getSelectedDocumentIds([0, 1, 2], queryResult, undefined);

            expect(result).toEqual([
                { _rid: 'rid-a', id: 'a', partitionKey: undefined },
                { _rid: 'rid-c', id: 'c', partitionKey: undefined },
            ]);
        });
    });
});
