/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Shared fixture types used by unit tests and (in phase 3) integration tests.
//
// QueryFixture       — a SELECT query with an optional partial AST matcher.
// NegativeParserFixture — a query that must produce parse errors.
// ---------------------------------------------------------------------------

import type { SqlQuery } from '../../ast/nodes.js';

// ========================== Query fixtures ====================================

/**
 * A single SELECT query fixture.
 *
 * Unit test usage:
 *   - call `parse(fixture.query)`, assert `errors` is empty
 *   - assert fields from `expectAst` against the returned AST
 *
 * Integration test usage (Phase 3):
 *   - run `fixture.query` against the real Cosmos DB Emulator
 *   - assert row count falls within [expectMinRows, expectMaxRows]
 *   - if `expectError` is true, assert the SDK throws
 *
 * Parameters (@param style) are NOT stored here.
 * Each test that exercises a parametrised query supplies its own values inline.
 */
export interface QueryFixture {
    /** Short identifier, e.g. "S-01" */
    id: string;
    /** One-line description */
    description: string;
    /** The SQL query string */
    query: string;
    /** Which seed container this query targets */
    container: 'products' | 'orders' | 'events';
    /**
     * Partial AST shape to assert in unit tests.
     * Only the fields present are checked — deep equality is not required.
     */
    expectAst?: Partial<SqlQuery>;
    // ── Integration-test fields (Phase 3, unused until then) ──────────────
    /** Minimum number of rows expected from the emulator */
    expectMinRows?: number;
    /** Maximum number of rows expected from the emulator */
    expectMaxRows?: number;
    /**
     * When true the query is expected to throw a runtime error
     * (e.g. unregistered UDF, type mismatch that Cosmos DB rejects).
     */
    expectError?: boolean;
}

// ========================== Negative parser fixtures =========================

/**
 * A query that must be rejected by the parser with at least one error.
 */
export interface NegativeParserFixture {
    /** Short identifier, e.g. "N-01" */
    id: string;
    /** One-line description */
    description: string;
    /** The malformed SQL query string */
    query: string;
    /**
     * If set, `errors[0].message` must contain this substring.
     * Leave undefined when the exact message is not predictable.
     */
    errorContains?: string;
}

