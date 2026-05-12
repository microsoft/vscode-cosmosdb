/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { NegativeParserFixture } from './types.js';

/**
 * Queries that must produce at least one parse error.
 *
 * N-01..N-14 are all confirmed to return errors.length > 0 against the parser.
 * N-15 is excluded here because it parses successfully (type mismatch is semantic-only);
 * it appears in negative-integration.ts instead.
 */
export const fixtures: NegativeParserFixture[] = [
    {
        id: 'N-01',
        description: 'Missing selection specification after SELECT',
        query: 'SELECT FROM c',
    },
    {
        id: 'N-02',
        description: 'FROM without collection name',
        query: 'SELECT * FROM',
    },
    {
        id: 'N-03',
        description: 'Incomplete BETWEEN — missing AND + upper bound',
        query: 'SELECT * FROM c WHERE c.price BETWEEN 10',
    },
    {
        id: 'N-04',
        description: 'Empty IN list — at least one item required',
        query: 'SELECT * FROM c WHERE c.category IN ()',
    },
    {
        id: 'N-05',
        description: 'ORDER BY without expression',
        query: 'SELECT * FROM c ORDER BY',
    },
    {
        id: 'N-06',
        description: 'OFFSET without value',
        query: 'SELECT * FROM c OFFSET LIMIT 10',
    },
    {
        id: 'N-07',
        description: 'LIMIT without value',
        query: 'SELECT * FROM c OFFSET 0 LIMIT',
    },
    {
        id: 'N-08',
        description: 'Incomplete binary expression in WHERE — missing right operand',
        query: 'SELECT * FROM c WHERE c.price =',
    },
    {
        id: 'N-09',
        description: 'Unclosed parenthesis',
        query: 'SELECT (',
    },
    {
        id: 'N-10',
        description: 'BETWEEN without left operand',
        query: 'SELECT * FROM c WHERE BETWEEN 1 AND 10',
    },
    {
        id: 'N-11',
        description: 'LIKE without pattern',
        query: 'SELECT * FROM c WHERE c.name LIKE',
    },
    {
        id: 'N-12',
        description: 'Incomplete GROUP BY — missing BY keyword and expression',
        query: 'SELECT * FROM c GROUP',
    },
    {
        id: 'N-13',
        description: 'SELECT TOP without numeric expression',
        query: 'SELECT TOP * FROM c',
    },
    {
        id: 'N-14',
        description: 'Misspelled SELECT keyword',
        query: 'SELCT * FROM c',
    },
];
