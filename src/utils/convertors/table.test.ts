/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { QueryResultMismatchError } from '../queryAnalysis';
import { queryResultToTable } from './table';
import { makeResult } from './testFixtures';

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
