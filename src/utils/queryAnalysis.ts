/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Static analysis utilities for CosmosDB NoSQL queries and their result shapes.
 *
 * Functions here operate on the query AST (no network calls) and on the
 * document arrays returned by the server.
 */

import { parse } from '@cosmosdb/nosql-language-service';
import { type QueryResultRecord } from '../cosmosdb/types/queryResult';

// ─── Query shape ─────────────────────────────────────────────────────────────

/**
 * What shape of documents a query is statically expected to produce.
 *
 * - `'unknown'`   — no query string, parse error, or cannot determine statically
 * - `'object'`    — SELECT *, SELECT list, SELECT VALUE { ... }
 *                   → each document is a plain object with named keys
 * - `'primitive'` — SELECT VALUE <scalar / array / function>
 *                   → each document is a scalar, null, or array (no named keys)
 */
export type QueryResultKind = 'unknown' | 'object' | 'primitive';

/**
 * We can retrieve the document id to open it in a separate tab only if record contains
 * {@link CosmosDBRecordIdentifier}. We can be 100% sure that all required fields are
 * present if query has `SELECT *` clause.
 *
 * Uses the AST parser to precisely detect `SELECT *` — avoids false positives
 * from arithmetic expressions like `SELECT c.price * c.qty FROM c`.
 */
export const isSelectStar = (query: string): boolean => {
    const { ast } = parse(query);
    return ast?.query?.select?.spec?.kind === 'SelectStarSpec';
};

/**
 * Returns the list of column names that a query will produce, or `null` if the
 * number/names of columns cannot be statically determined.
 *
 * - `SELECT *`       → `null`  (all document fields, count unknown)
 * - `SELECT VALUE e` → `null`  (flat scalar array, no named columns)
 * - `SELECT a, b, c` → `['a', 'b', 'c']`
 *
 * Each element is either:
 *  - the `AS` alias string, if present
 *  - the last identifier of a property-ref path (`c.foo.bar` → `'bar'`)
 *  - `null` when the column name cannot be determined statically
 *    (arithmetic, function calls, object literals without alias, etc.)
 *
 * The outer `null` means "we don't know how many columns there will be".
 * An inner `null` means "we know there is a column here, but not its name".
 */
export const getQueryColumns = (query: string): (string | null)[] | null => {
    const { ast } = parse(query);
    const spec = ast?.query?.select?.spec;
    if (!spec) return null;

    if (spec.kind === 'SelectListSpec') {
        return spec.items.map((item) => {
            if (item.alias) {
                return item.alias.value;
            }
            if (item.expression.kind === 'PropertyRefScalarExpression') {
                return item.expression.identifier.value;
            }
            return null;
        });
    }

    // SELECT VALUE { "x": expr, "y": expr } → statically-known object keys
    if (spec.kind === 'SelectValueSpec') {
        if (spec.expression.kind === 'ObjectCreateScalarExpression') {
            return spec.expression.properties.map((p) => p.name.value);
        }
        return null; // scalar / array / function call → primitive path
    }

    // SelectStarSpec → column names come from scanning documents at runtime
    return null;
};

/**
 * Determines the expected result shape for a CosmosDB NoSQL query by inspecting its AST.
 */
export const getQueryResultKind = (query: string | undefined | null): QueryResultKind => {
    if (!query) return 'unknown';
    const { ast } = parse(query);
    if (!ast) return 'unknown';

    const spec = ast.query.select.spec;
    if (spec.kind === 'SelectStarSpec' || spec.kind === 'SelectListSpec') return 'object';
    if (spec.kind === 'SelectValueSpec') {
        // { ... } literal → still produces objects
        if (spec.expression.kind === 'ObjectCreateScalarExpression') return 'object';
        return 'primitive';
    }
    return 'unknown';
};

// ─── Document collection shape ────────────────────────────────────────────────

/**
 * Describes the homogeneity of a document collection.
 *
 * - `'empty'`     — no documents at all
 * - `'primitive'` — every document is a scalar or null (e.g. `SELECT VALUE c.name`)
 * - `'object'`    — every document is a plain object (no arrays at the top level)
 * - `'mixed'`     — collection contains both primitives/arrays and plain objects
 */
export type DocumentCollectionKind = 'empty' | 'primitive' | 'object' | 'mixed';

/**
 * Checks whether all documents in an array have the same structural kind:
 * either all are plain objects, or all are scalars/null/arrays.
 * A mixed result is flagged as inconsistent.
 */
export const getDocumentCollectionKind = (documents: QueryResultRecord[]): DocumentCollectionKind => {
    if (documents.length === 0) return 'empty';

    let hasObjects = false;
    let hasPrimitives = false;

    for (const doc of documents) {
        if (doc !== null && typeof doc === 'object' && !Array.isArray(doc)) {
            hasObjects = true;
        } else {
            hasPrimitives = true; // null, scalars, and arrays — no named keys
        }
        if (hasObjects && hasPrimitives) return 'mixed';
    }

    return hasObjects ? 'object' : 'primitive';
};

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * Thrown when the actual data returned by CosmosDB does not match the shape
 * that the query was statically determined to produce.
 */
export class QueryResultMismatchError extends Error {
    constructor(queryKind: QueryResultKind, dataKind: DocumentCollectionKind) {
        super(`Query expected "${queryKind}" results but received "${dataKind}" data`);
        this.name = 'QueryResultMismatchError';
    }
}
