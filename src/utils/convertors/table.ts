/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Table conversion: turn a SerializedQueryResult into headers + row records for the data grid.
 *
 * NOTE: Mostly of these functions are async to be able to move them to backend in the future.
 */

import { type ItemDefinition, type JSONObject, type PartitionKeyDefinition } from '@azure/cosmos';
import { isEmptyObject } from 'es-toolkit';
import { CosmosDBHiddenFields } from '../../cosmosdb/cosmosdb-shared-constants';
import { type SerializedQueryResult } from '../../cosmosdb/types/queryResult';
import { extractPartitionKey, getDocumentId } from '../document';
import {
    QueryResultMismatchError,
    getDocumentCollectionKind,
    getQueryColumns,
    getQueryResultKind,
    isSelectStar,
} from '../queryAnalysis';
import { sanitizeDisplayString } from '../sanitization';
import { type ColumnOptions, MAX_TREE_LEVEL_LENGTH, type TableData, type TableRecord } from './types';

/**
 * Checks if a value is a NonePartitionKey (empty object used by Cosmos DB SDK).
 * NonePartitionKeyLiteral from @azure/cosmos is defined as {} and represents
 * a partition key value for items without a value for partition key.
 */
const isNonePartitionKey = (value: unknown): boolean => {
    return isEmptyObject(value);
};

/**
 * Get the headers for the table (don't take into account the nested objects)
 *
 * If `query` is provided and the SELECT clause projects a fixed set of columns
 * (i.e. not `SELECT *` / `SELECT VALUE`), those column names are returned in
 * declaration order, ignoring the `options` sorting/partition-key settings —
 * the user already decided the shape of the result set.
 *
 * When the column set cannot be determined statically (or no `query` is given),
 * the function falls back to scanning all documents for keys as before.
 * Documents that are not plain objects (null, scalars, arrays) are skipped
 * during the scan.
 *
 * Exported for reuse by the tree converter; not part of the public barrel.
 *
 * @param documents  Result documents — `QueryResultRecord[]` i.e. `JSONValue[]`
 * @param partitionKey
 * @param options
 */
export const buildTableHeadersFromObjectDocuments = (
    documents: JSONObject[],
    partitionKey: PartitionKeyDefinition | undefined,
    options: ColumnOptions,
): string[] => {
    // At this point the caller guarantees all documents are plain objects (collectionKind === 'object').
    const keys = new Set<string>();
    const serviceKeys = new Set<string>();

    documents.forEach((doc) => {
        Object.keys(doc as object).forEach((key) => {
            if (CosmosDBHiddenFields.includes(key)) {
                serviceKeys.add(key);
            } else {
                keys.add(key);
            }
        });
    });

    const columns = Array.from(keys);
    const serviceColumns = Array.from(serviceKeys);
    const partitionKeyPaths = (partitionKey?.paths ?? []).map((path) => (path.startsWith('/') ? path : `/${path}`));
    const resultColumns: string[] = [];

    if (options.ShowPartitionKey === 'first') {
        // Remove partition key paths from columns, since partition key paths are always shown first
        partitionKeyPaths.forEach((path) => {
            const index = columns.indexOf(path.slice(1));
            if (index !== -1) {
                columns.splice(index, 1);
            }
        });

        // If id is not in the partition key, add it as the first column
        if (!partitionKeyPaths.includes('/id')) {
            partitionKeyPaths.unshift('id');
        }

        partitionKeyPaths.forEach((path) => resultColumns.push(path));
    }

    if (options.Sorting === 'ascending') {
        columns.sort((a, b) => a.localeCompare(b)).forEach((column) => resultColumns.push(column));
    }

    if (options.Sorting === 'descending') {
        columns.sort((a, b) => b.localeCompare(a)).forEach((column) => resultColumns.push(column));
    }

    if (options.Sorting === 'none') {
        columns.forEach((column) => resultColumns.push(column));
    }

    if (options.ShowServiceColumns === 'last') {
        if (options.Sorting === 'ascending') {
            serviceColumns.sort((a, b) => a.localeCompare(b)).forEach((column) => resultColumns.push(column));
        }
        if (options.Sorting === 'descending') {
            serviceColumns.sort((a, b) => b.localeCompare(a)).forEach((column) => resultColumns.push(column));
        }
        if (options.Sorting === 'none') {
            serviceColumns.forEach((column) => resultColumns.push(column));
        }
    }

    // Remove duplicates while keeping order
    const uniqueHeaders = new Set<string>(resultColumns);

    return Array.from(uniqueHeaders);
};

/**
 * Get the dataset for the table.
 *
 * Uses `getDocumentCollectionKind` to determine the data shape:
 *
 * - **object** path  — each document is a plain object; fields are stored as raw
 *   values (not pre-serialized). String values are sanitized (control chars
 *   stripped). Partition key virtual columns are injected when
 *   `options.ShowPartitionKey === 'first'`.
 * - **primitive** path — each document (scalar / null / array) is stored under
 *   the synthetic key `_value1`.
 * - **empty / mixed** — returns an empty array.
 *
 * The UI layer is responsible for calling `toStringUniversal` / `truncateString`
 * at render time; this function stores raw values.
 */
const buildTableRowsFromObjectDocuments = async (
    documents: JSONObject[],
    partitionKey: PartitionKeyDefinition | undefined,
    options: ColumnOptions,
): Promise<TableRecord[]> => {
    const injectPartitionKey = options.ShowPartitionKey === 'first' && !!partitionKey;

    const result = new Array<TableRecord>();
    const chunkSize = 1000;

    for (let i = 0; i < documents.length; i += chunkSize) {
        const chunk = documents.slice(i, i + chunkSize);

        chunk.forEach((docRaw) => {
            // collectionKind === 'object' is guaranteed by the guard above
            const doc = docRaw as Record<string, unknown>;
            const row: TableRecord = {
                __id: globalThis.crypto.randomUUID(),
                __documentId: getDocumentId(docRaw as unknown as ItemDefinition, partitionKey) ?? undefined,
            };

            // Inject virtual partition key columns (only for SELECT *)
            if (injectPartitionKey) {
                const partitionKeyPaths = (partitionKey.paths ?? []).map((path) =>
                    path.startsWith('/') ? path.slice(1) : path,
                );
                const partitionKeyValues = extractPartitionKey(docRaw as unknown as ItemDefinition, partitionKey);
                const valuesArray = Array.isArray(partitionKeyValues) ? partitionKeyValues : [partitionKeyValues];

                partitionKeyPaths.forEach((path, index) => {
                    const value: unknown = valuesArray[index];
                    row[path] = isNonePartitionKey(value) ? undefined : (value ?? undefined);
                });
            }

            // Copy all document fields as raw values; sanitise strings
            Object.entries(doc).forEach(([key, value]) => {
                row[key] = typeof value === 'string' ? sanitizeDisplayString(value) : value;
            });

            result.push(row);
        });

        if (i + chunkSize < documents.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    return result;
};

/**
 * Prepare the table data from the query result.
 *
 * Reconciliation matrix (queryKind × dataKind):
 *
 * | queryKind   | dataKind   | Action                                              |
 * |-------------|------------|-----------------------------------------------------|
 * | any         | empty      | return empty immediately                            |
 * | object      | object     | normal object path + partition key for SELECT *     |
 * | object      | primitive  | throw QueryResultMismatchError                      |
 * | object      | mixed      | throw QueryResultMismatchError                      |
 * | primitive   | any        | _value1 column — SELECT VALUE means "one value"     |
 * | unknown     | object     | fallback: scan document keys (legacy)               |
 * | unknown     | primitive  | _value1 column                                      |
 * | unknown     | mixed      | return empty (cannot render safely)                 |
 *
 * `ShowPartitionKey: 'first'` is automatically set **only** for `SELECT *`
 * (i.e. when `queryKind === 'object'` AND the spec is `SelectStarSpec`).
 */
export const queryResultToTable = async (
    queryResult: SerializedQueryResult | null,
    partitionKey: PartitionKeyDefinition | undefined,
    options: ColumnOptions = {
        ShowPartitionKey: 'none',
        ShowServiceColumns: 'none',
        Sorting: 'none',
        TruncateValues: MAX_TREE_LEVEL_LENGTH,
    },
): Promise<TableData> => {
    if (!queryResult?.documents?.length) {
        return { headers: [], dataset: [] };
    }

    const query = queryResult.query ?? '';
    const queryKind = getQueryResultKind(query);
    const dataKind = getDocumentCollectionKind(queryResult.documents);

    // Empty data — nothing to show
    if (dataKind === 'empty') {
        return { headers: [], dataset: [] };
    }

    // SELECT VALUE — user explicitly asked for value-as-is, always one _value1 column.
    // The expression may evaluate to a scalar, array, or even a full document object —
    // all of these are treated as a single opaque value per row.
    if (queryKind === 'primitive') {
        const headers = ['_value1'];
        const dataset: TableRecord[] = queryResult.documents.map((doc) => ({
            __id: globalThis.crypto.randomUUID(),
            _value1: typeof doc === 'string' ? sanitizeDisplayString(doc) : doc,
        }));
        return { headers, dataset };
    }

    // SELECT * / SELECT list returned mixed or scalar data — real server-side error
    if (queryKind === 'object' && (dataKind === 'primitive' || dataKind === 'mixed')) {
        throw new QueryResultMismatchError(queryKind, dataKind);
    }

    // unknown queryKind with mixed data — cannot render safely
    if (dataKind === 'mixed') {
        return { headers: [], dataset: [] };
    }

    const effectiveOptions = { ...options };
    if (isSelectStar(query)) {
        effectiveOptions.ShowPartitionKey = 'first';
    }

    // Fast path: query can have a statically-known set of projected columns
    const queryColumns =
        getQueryColumns(query) ??
        buildTableHeadersFromObjectDocuments(queryResult.documents as JSONObject[], partitionKey, effectiveOptions);

    // Columns without a resolvable name (arithmetic, function calls, etc.)
    // get a synthetic fallback name: _value1, _value2, …
    let unnamedCounter = 0;
    const headers = queryColumns.map((col) => col ?? `_value${++unnamedCounter}`);

    const dataset = await buildTableRowsFromObjectDocuments(
        queryResult.documents as JSONObject[],
        partitionKey,
        effectiveOptions,
    );

    return { headers, dataset };
};
