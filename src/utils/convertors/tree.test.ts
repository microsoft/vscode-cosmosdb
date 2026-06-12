/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryResultMismatchError } from '../queryAnalysis';
import { makeResult } from './testFixtures';
import { queryResultToTree } from './tree';

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
