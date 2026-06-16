/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// ORDER BY inside a subquery detection.
//
// Azure Cosmos DB NoSQL does **not** support `ORDER BY` inside any subquery —
// scalar subqueries (`ARRAY`, `FIRST`, `LAST`, `(SELECT …)`), `EXISTS`, and
// subqueries in the `FROM` clause. The backend rejects such queries at
// execution time with HTTP 400, even though the grammar (the native C++
// `sql.y`) accepts them syntactically: every subquery form embeds a full
// `sql_query`, which carries an optional `opt_orderby_clause`. The restriction
// is therefore semantic, not grammatical, and is not documented in the
// language reference — so we surface it as a static diagnostic instead.
//
// See: https://github.com/Azure/azure-cosmos-db-emulator-docker/issues/311
//
// Only the **outer** query may use `ORDER BY`; any `ORDER BY` on a nested
// query is flagged as an error.
// ---------------------------------------------------------------------------

import { type SqlProgram, type SqlQuery } from '../ast/nodes.js';
import { type SourceRange } from '../errors/SqlError.js';

// ========================== Public types ======================================

export interface OrderByInSubqueryError {
    /** Source range of the offending `ORDER BY` clause. */
    range: SourceRange;
    /** Human-readable error message. */
    message: string;
}

export const ORDER_BY_IN_SUBQUERY_MESSAGE =
    'ORDER BY is not supported inside a subquery in Azure Cosmos DB NoSQL. ' +
    'Remove it, or move the ordering to the outermost query.';

// ========================== Main entry point ==================================

/**
 * Walk a parsed AST and report every `ORDER BY` clause that appears inside a
 * subquery (i.e. on any query other than the outermost one).
 *
 * Takes the already-parsed {@link SqlProgram} rather than the query string so
 * callers can reuse their existing parse result (and to avoid an import cycle
 * with the `parse` entry point). Returns an empty array when `ast` is
 * undefined or contains no nested `ORDER BY`.
 */
export function detectOrderByInSubquery(ast: SqlProgram | undefined): OrderByInSubqueryError[] {
    if (!ast) return [];

    const errors: OrderByInSubqueryError[] = [];

    // Generic AST walk. The root query (`ast.query`) is allowed to use ORDER BY;
    // every other `Query` node is, by the grammar, reachable only through a
    // subquery construct, so its ORDER BY is illegal. `isRoot` flips to false as
    // soon as we descend past the outermost query.
    const walk = (value: unknown, isRoot: boolean): void => {
        if (Array.isArray(value)) {
            for (const item of value) walk(item, isRoot);
            return;
        }
        if (!value || typeof value !== 'object') return;

        const node = value as Record<string, unknown>;
        if (typeof node.kind !== 'string') return; // e.g. a SourceRange — no children of interest

        if (node.kind === 'Query' && !isRoot) {
            const query = node as unknown as SqlQuery;
            if (query.orderBy) {
                const range = query.orderBy.range ?? query.range;
                if (range) {
                    errors.push({ range, message: ORDER_BY_IN_SUBQUERY_MESSAGE });
                }
            }
        }

        for (const key of Object.keys(node)) {
            if (key === 'range') continue; // SourceRange holds no AST children
            walk(node[key], false);
        }
    };

    walk(ast.query, true);
    return errors;
}
