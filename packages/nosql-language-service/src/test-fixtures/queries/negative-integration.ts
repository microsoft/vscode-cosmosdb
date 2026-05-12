/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import type { QueryFixture } from './types.js';

/**
 * Queries that must return 0 rows or throw a runtime error on the emulator.
 *
 * These fixtures parse without errors but produce no results (or a runtime
 * exception) when run against the real Cosmos DB Emulator. Used by the Phase 3
 * integration test suite.
 *
 * N-15 from the negative-parser catalogue is included here because the query
 * `SELECT * FROM c WHERE c.price > "hello"` parses successfully — type
 * mismatch is only detectable at runtime.
 */
export const fixtures: QueryFixture[] = [
    {
        id: 'I-01',
        description: 'Field does not exist — expects 0 results',
        query: 'SELECT * FROM c WHERE c.nonexistent = "value"',
        container: 'products',
        expectMaxRows: 0,
    },
    {
        id: 'I-02',
        description: 'Type mismatch: string compared to number — expects 0 results',
        query: 'SELECT * FROM c WHERE c.price > "expensive"',
        container: 'products',
        expectMaxRows: 0,
    },
    {
        id: 'I-03',
        description: 'Array vs string comparison — expects 0 results',
        query: 'SELECT * FROM c WHERE c.tags = "sale"',
        container: 'products',
        expectMaxRows: 0,
    },
    {
        id: 'I-04',
        description: 'No matching enum value for status — expects 0 results',
        query: 'SELECT * FROM c WHERE c.status = "unknown"',
        container: 'orders',
        expectMaxRows: 0,
    },
    {
        id: 'I-05',
        description: 'ORDER BY on undefined path — sorts as null, not an error',
        query: 'SELECT * FROM c ORDER BY c.nonexistent ASC',
        container: 'events',
        expectMinRows: 0,
    },
    {
        id: 'I-06',
        description: 'Direct property on array without JOIN — expects 0 results',
        query: 'SELECT * FROM c WHERE c.items.name = "Widget"',
        container: 'orders',
        expectMaxRows: 0,
    },
    {
        id: 'I-07',
        description: 'UDF not registered — runtime error expected',
        query: 'SELECT udf.notExists(c.id) FROM c',
        container: 'products',
        expectError: true,
    },
    {
        id: 'I-08',
        description: 'Offset beyond data size — expects 0 results',
        query: 'SELECT * FROM c OFFSET 100000 LIMIT 10',
        container: 'products',
        expectMaxRows: 0,
    },
    {
        id: 'I-09',
        description: 'SELECT TOP 0 — edge case, expects 0 results',
        query: 'SELECT TOP 0 * FROM c',
        container: 'products',
        expectMaxRows: 0,
    },
    {
        id: 'I-10',
        description: 'Math function on string (N-15) — undefined/error behavior',
        query: 'SELECT * FROM c WHERE SQRT(c.name) > 0',
        container: 'products',
        expectMaxRows: 0,
    },
];
