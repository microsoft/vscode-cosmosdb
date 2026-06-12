/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { type SerializedQueryMetrics, type SerializedQueryResult } from '../../cosmosdb/types/queryResult';
import { QueryResultMismatchError } from '../queryAnalysis';
import {
    indexMetricsToTableItem,
    queryMetricsToJSON,
    queryMetricsToTable,
    queryResultToJSON,
    queryResultToTable,
    queryResultToTree,
} from './index';

/** Build a SerializedQueryResult with sensible defaults, overriding only what a test needs. */
function makeResult(partial: Partial<SerializedQueryResult> = {}): SerializedQueryResult {
    return {
        documents: [],
        iteration: 1,
        metadata: {},
        indexMetrics: '',
        requestCharge: 0,
        roundTrips: 0,
        hasMoreResults: false,
        query: '',
        ...partial,
    };
}

function makeMetrics(partial: Partial<SerializedQueryMetrics> = {}): SerializedQueryMetrics {
    return {
        documentLoadTime: 0,
        documentWriteTime: 0,
        indexHitDocumentCount: 0,
        outputDocumentCount: 0,
        outputDocumentSize: 0,
        indexLookupTime: 0,
        retrievedDocumentCount: 0,
        retrievedDocumentSize: 0,
        vmExecutionTime: 0,
        runtimeExecutionTimes: {
            queryEngineExecutionTime: 0,
            systemFunctionExecutionTime: 0,
            userDefinedFunctionExecutionTime: 0,
        },
        totalQueryExecutionTime: 0,
        ...partial,
    };
}

describe('convertors', () => {
    // ─── queryResultToJSON ────────────────────────────────────────────────────
    describe('queryResultToJSON', () => {
        it('returns an empty string for null', () => {
            expect(queryResultToJSON(null)).toBe('');
        });

        it('serializes all documents pretty-printed', () => {
            const result = makeResult({ documents: [{ a: 1 }, { b: 2 }] });
            expect(queryResultToJSON(result)).toBe(JSON.stringify([{ a: 1 }, { b: 2 }], null, 4));
        });

        it('serializes only the selected documents (by index)', () => {
            const result = makeResult({ documents: [{ a: 1 }, { b: 2 }, { c: 3 }] });
            expect(queryResultToJSON(result, [0, 2])).toBe(JSON.stringify([{ a: 1 }, { c: 3 }], null, 4));
        });

        it('returns "[]" when the selection matches nothing', () => {
            const result = makeResult({ documents: [{ a: 1 }] });
            expect(queryResultToJSON(result, [5])).toBe(JSON.stringify([], null, 4));
        });
    });

    // ─── queryResultToTable ───────────────────────────────────────────────────
    describe('queryResultToTable', () => {
        it('returns empty table for null / empty documents', async () => {
            expect(await queryResultToTable(null, undefined)).toEqual({ headers: [], dataset: [] });
            expect(await queryResultToTable(makeResult(), undefined)).toEqual({ headers: [], dataset: [] });
        });

        it('SELECT VALUE scalar → single _value1 column', async () => {
            const result = makeResult({ query: 'SELECT VALUE c.name FROM c', documents: ['Alice', 'Bob'] });
            const table = await queryResultToTable(result, undefined);
            expect(table.headers).toEqual(['_value1']);
            expect(table.dataset.map((r) => r._value1)).toEqual(['Alice', 'Bob']);
        });

        it('SELECT * with object docs → id first, then fields (partition key first)', async () => {
            const result = makeResult({ query: 'SELECT * FROM c', documents: [{ id: '1', name: 'x' }] });
            const table = await queryResultToTable(result, undefined);
            expect(table.headers).toEqual(['id', 'name']);
            expect(table.dataset[0].id).toBe('1');
            expect(table.dataset[0].name).toBe('x');
            // each row carries an internal __id
            expect(typeof table.dataset[0].__id).toBe('string');
        });

        it('SELECT list → fixed projected columns, ignoring extra document fields', async () => {
            const result = makeResult({
                query: 'SELECT c.id, c.name FROM c',
                documents: [{ id: '1', name: 'x', extra: 'ignored' }],
            });
            const table = await queryResultToTable(result, undefined);
            expect(table.headers).toEqual(['id', 'name']);
        });

        it('unnamed projected column (arithmetic) → synthetic _value1 header', async () => {
            const result = makeResult({ query: 'SELECT c.a + c.b FROM c', documents: [{ result: 5 }] });
            const table = await queryResultToTable(result, undefined);
            expect(table.headers).toEqual(['_value1']);
        });

        it('throws QueryResultMismatchError when an object query returns primitive data', async () => {
            const result = makeResult({ query: 'SELECT * FROM c', documents: ['scalar'] });
            await expect(queryResultToTable(result, undefined)).rejects.toBeInstanceOf(QueryResultMismatchError);
        });

        it('returns empty table for unknown query with mixed data', async () => {
            const result = makeResult({ query: '', documents: [{ a: 1 }, 'scalar'] });
            expect(await queryResultToTable(result, undefined)).toEqual({ headers: [], dataset: [] });
        });

        it('injects virtual partition-key column for SELECT * when a partition key is provided', async () => {
            const partitionKey: PartitionKeyDefinition = { paths: ['/pk'] } as PartitionKeyDefinition;
            const result = makeResult({ query: 'SELECT * FROM c', documents: [{ id: '1', pk: 'tenant-a' }] });
            const table = await queryResultToTable(result, partitionKey);
            // partition-key path column is shown (prefixed with /), id first
            expect(table.headers).toContain('/pk');
            expect(table.headers[0]).toBe('id');
            expect(table.dataset[0]['pk']).toBe('tenant-a');
        });
    });

    // ─── queryResultToTree ────────────────────────────────────────────────────
    describe('queryResultToTree', () => {
        it('returns [] for empty / primitive collections', async () => {
            expect(await queryResultToTree(makeResult(), undefined)).toEqual([]);
            expect(await queryResultToTree(makeResult({ documents: ['a', 'b'] }), undefined)).toEqual([]);
        });

        it('builds a Document row with nested children for object docs', async () => {
            const result = makeResult({ documents: [{ id: 'doc-1', tags: ['a', 'b'] }] });
            const rows = await queryResultToTree(result, undefined);
            expect(rows).toHaveLength(1);
            expect(rows[0].type).toBe('Document');
            expect(rows[0].field).toBe('doc-1');

            const fields = rows[0].children?.map((c) => c.field);
            expect(fields).toContain('id');
            expect(fields).toContain('tags');

            const tagsRow = rows[0].children?.find((c) => c.field === 'tags');
            expect(tagsRow?.type).toBe('Array');
            expect(tagsRow?.children).toHaveLength(2);
        });

        it('throws QueryResultMismatchError when an object query returns mixed data', async () => {
            const result = makeResult({ query: 'SELECT * FROM c', documents: [{ a: 1 }, 'scalar'] });
            await expect(queryResultToTree(result, undefined)).rejects.toBeInstanceOf(QueryResultMismatchError);
        });
    });

    // ─── queryMetricsToTable ──────────────────────────────────────────────────
    describe('queryMetricsToTable', () => {
        it('returns [] when there is no result or no metrics', async () => {
            expect(await queryMetricsToTable(null)).toEqual([]);
            expect(await queryMetricsToTable(makeResult())).toEqual([]);
        });

        it('formats the request charge and includes core metrics', async () => {
            const result = makeResult({ requestCharge: 5, queryMetrics: makeMetrics({ retrievedDocumentSize: 128 }) });
            const stats = await queryMetricsToTable(result);
            const charge = stats.find((s) => s.metric === 'Request Charge');
            expect(charge?.formattedValue).toBe('5 RUs');
            const size = stats.find((s) => s.metric === 'Retrieved document size');
            expect(size?.formattedValue).toBe('128 bytes');
        });

        it('appends Round Trips and Activity id only when present', async () => {
            const without = await queryMetricsToTable(makeResult({ roundTrips: 0, queryMetrics: makeMetrics() }));
            expect(without.some((s) => s.metric === 'Round Trips')).toBe(false);
            expect(without.some((s) => s.metric === 'Activity id')).toBe(false);

            const withExtra = await queryMetricsToTable(
                makeResult({ roundTrips: 3, activityId: 'abc', queryMetrics: makeMetrics() }),
            );
            expect(withExtra.find((s) => s.metric === 'Round Trips')?.value).toBe(3);
            expect(withExtra.find((s) => s.metric === 'Activity id')?.value).toBe('abc');
        });

        it('renders "All" results when countPerPage is -1 and there are no documents', async () => {
            const result = makeResult({ metadata: { countPerPage: -1 }, documents: [], queryMetrics: makeMetrics() });
            const stats = await queryMetricsToTable(result);
            expect(stats.find((s) => s.metric === 'Showing Results')?.value).toBe('All');
        });

        it('renders a 0 - N range when countPerPage is -1 and documents exist', async () => {
            const result = makeResult({
                metadata: { countPerPage: -1 },
                documents: [{ a: 1 }, { b: 2 }],
                queryMetrics: makeMetrics(),
            });
            const stats = await queryMetricsToTable(result);
            expect(stats.find((s) => s.metric === 'Showing Results')?.value).toBe('0 - 2');
        });
    });

    // ─── indexMetricsToTableItem ──────────────────────────────────────────────
    describe('indexMetricsToTableItem', () => {
        it('trims the raw index metrics string', () => {
            const item = indexMetricsToTableItem(makeResult({ indexMetrics: '  some metrics  ' }));
            expect(item.metric).toBe('Index Metrics');
            expect(item.value).toBe('some metrics');
            expect(item.formattedValue).toBe('some metrics');
        });
    });

    // ─── queryMetricsToJSON ───────────────────────────────────────────────────
    describe('queryMetricsToJSON', () => {
        it('returns an empty string for null', async () => {
            expect(await queryMetricsToJSON(null)).toBe('');
        });

        it('serializes metrics and appends the index metrics item', async () => {
            const result = makeResult({ indexMetrics: 'idx', queryMetrics: makeMetrics() });
            const json = await queryMetricsToJSON(result);
            const parsed = JSON.parse(json) as Array<{ metric: string; value: unknown }>;
            expect(parsed.some((s) => s.metric === 'Index Metrics' && s.value === 'idx')).toBe(true);
        });
    });
});
