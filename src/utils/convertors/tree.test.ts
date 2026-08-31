/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { QueryResultMismatchError } from '../queryAnalysis';
import { makeResult } from './testFixtures';
import { queryResultToTree } from './tree';
import { MAX_TREE_LEVEL_LENGTH } from './types';

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

    it('expands nested object values into sorted child rows', async () => {
        const result = makeResult({ documents: [{ id: 'd', meta: { z: 1, a: 2 } }] });
        const rows = await queryResultToTree(result, undefined);
        const metaRow = rows[0].children?.find((c) => c.field === 'meta');
        expect(metaRow?.type).toBe('Object');
        expect(metaRow?.value).toBe('{...}');
        // Object keys are rendered in ascending order.
        expect(metaRow?.children?.map((c) => c.field)).toEqual(['a', 'z']);
    });

    it('truncates arrays longer than MAX_TREE_LEVEL_LENGTH with a notice row', async () => {
        const big = Array.from({ length: MAX_TREE_LEVEL_LENGTH + 50 }, (_, i) => i);
        const result = makeResult({ documents: [{ id: 'd', big }] });
        const rows = await queryResultToTree(result, undefined);
        const bigRow = rows[0].children?.find((c) => c.field === 'big');
        expect(bigRow?.type).toBe('Array');
        expect(bigRow?.children).toHaveLength(MAX_TREE_LEVEL_LENGTH + 1);
        expect(bigRow?.children?.[MAX_TREE_LEVEL_LENGTH].value).toContain('too large');
    });

    it('truncates objects with more than MAX_TREE_LEVEL_LENGTH keys with a notice row', async () => {
        const obj: Record<string, number> = {};
        for (let i = 0; i < MAX_TREE_LEVEL_LENGTH + 50; i++) {
            obj['k' + String(i).padStart(4, '0')] = i;
        }
        const result = makeResult({ documents: [{ id: 'd', obj }] });
        const rows = await queryResultToTree(result, undefined);
        const objRow = rows[0].children?.find((c) => c.field === 'obj');
        expect(objRow?.type).toBe('Object');
        expect(objRow?.children).toHaveLength(MAX_TREE_LEVEL_LENGTH + 1);
        expect(objRow?.children?.[MAX_TREE_LEVEL_LENGTH].value).toContain('too large');
    });

    it('includes partition-key path rows when a partition key is provided', async () => {
        const partitionKey: PartitionKeyDefinition = { paths: ['/pk'] } as PartitionKeyDefinition;
        const result = makeResult({ documents: [{ id: 'd1', pk: 'tenant-a' }] });
        const rows = await queryResultToTree(result, partitionKey);
        const pkRow = rows[0].children?.find((c) => c.field === '/pk');
        expect(pkRow?.value).toBe('tenant-a');
    });

    it('uses an index-number field when the document id is missing', async () => {
        const result = makeResult({ documents: [{ name: 'no-id-here' }] });
        const rows = await queryResultToTree(result, undefined);
        expect(rows[0].field).toContain('id is missing');
    });
});
