/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * NOTE: Mostly of these functions are async to be able to move them to backend in the future
 */

import { type ItemDefinition, type JSONObject, type PartitionKeyDefinition } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import { isEmptyObject } from 'es-toolkit';
import { v4 as uuid } from 'uuid';
import { CosmosDBHiddenFields } from '../cosmosdb/cosmosdb-shared-constants';
import { type CosmosDBRecordIdentifier, type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { extractPartitionKey, extractPartitionKeyValues, getDocumentId } from './document';
import {
    QueryResultMismatchError,
    getDocumentCollectionKind,
    getQueryColumns,
    getQueryResultKind,
    isSelectStar,
} from './queryAnalysis';
import { sanitizeDisplayString } from './sanitization';
import { leftPadIndex, toStringUniversal } from './strings';

export type StatsItem = {
    metric: string;
    value: string | number;
    formattedValue: string;
    tooltip: string;
};

/** Row metadata — never overlaps with document field names */
export type TableRowMeta = {
    __id: string;
    __documentId?: CosmosDBRecordIdentifier;
};

/**
 * A single table row.
 * `__id` and `__documentId` are internal; all other keys are raw document
 * values (not pre-serialized). The UI layer calls `toStringUniversal` at render time.
 */
export type TableRecord = TableRowMeta & {
    [key: string]: unknown;
};

export type TableData = {
    headers: string[];
    dataset: TableRecord[];
};

/**
 * Tree row format for hierarchical tree view.
 * Uses nested children array for tree structure.
 */
export type TreeRow = {
    id: string;
    documentId?: CosmosDBRecordIdentifier;
    field: string;
    value: string;
    type: string;
    children?: TreeRow[];
    isExpanded?: boolean;
};

export type ColumnOptions = {
    ShowPartitionKey: 'first' | 'none'; // 'first' = show id + partition key first, 'none' = the nested partition key values are hidden + partition key are shown as is (without / prefix)
    ShowServiceColumns: 'last' | 'none'; // 'last' = show service columns last, 'none' = hide service columns
    Sorting: 'ascending' | 'descending' | 'none'; // 'ascending' = sort columns in ascending order, 'descending' = sort columns in descending order, 'none' = no sorting
    TruncateValues: number; // truncate values to this length, 0 = no truncation
};

const MAX_TREE_LEVEL_LENGTH = 100;

/**
 * Checks if a value is a NonePartitionKey (empty object used by Cosmos DB SDK).
 * NonePartitionKeyLiteral from @azure/cosmos is defined as {} and represents
 * a partition key value for items without a value for partition key.
 */
const isNonePartitionKey = (value: unknown): boolean => {
    return isEmptyObject(value);
};

export const queryResultToJSON = (queryResult: SerializedQueryResult | null, selection?: number[]): string => {
    if (!queryResult) {
        return '';
    }

    if (selection) {
        const selectedDocs = queryResult.documents
            .map((doc, index) => {
                if (!selection.includes(index)) {
                    return null;
                }
                return doc;
            })
            .filter((doc) => doc !== null);

        return JSON.stringify(selectedDocs, null, 4);
    }

    return JSON.stringify(queryResult.documents, null, 4);
};

export const queryResultToTree = async (
    queryResult: SerializedQueryResult | null,
    partitionKey: PartitionKeyDefinition | undefined,
): Promise<TreeRow[]> => {
    if (!queryResult?.documents?.length) {
        return [];
    }

    const queryKind = getQueryResultKind(queryResult.query);
    const dataKind = getDocumentCollectionKind(queryResult.documents);

    // Tree view only makes sense for structured object documents
    if (dataKind === 'empty' || dataKind === 'primitive') {
        return [];
    }
    if (queryKind === 'object' && dataKind !== 'object') {
        throw new QueryResultMismatchError(queryKind, dataKind);
    }
    if (dataKind !== 'object') {
        // unknown queryKind with mixed/primitive data — cannot render as tree
        return [];
    }

    const rows: TreeRow[] = [];
    const docsLength = queryResult.documents.length;

    for (let i = 0; i < docsLength; i++) {
        // dataKind === 'object' is guaranteed by the guard above
        const doc = queryResult.documents[i] as ItemDefinition;
        const docRow = await documentToTreeRow(doc, partitionKey, leftPadIndex(i, docsLength));
        rows.push(docRow);

        // Yield to the event loop periodically to avoid UI freezes
        if (i % 100 === 0 && i > 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    return rows;
};

/**
 * Get the type name for a value
 */
const getTypeName = (value: unknown): string => {
    if (value === null) return 'Null';
    if (value === undefined) return 'Undefined';
    if (Array.isArray(value)) return 'Array';

    const type = typeof value;
    return type.charAt(0).toUpperCase() + type.slice(1);
};

/**
 * Get the display value for a tree row
 */
const getDisplayValue = (value: unknown): string => {
    if (Array.isArray(value)) return `(elements: ${value.length})`;
    if (value && typeof value === 'object') return '{...}';
    return toStringUniversal(value);
};

/**
 * Convert a value to a TreeRow with nested children
 */
const valueToTreeRow = (id: string, field: string, value: unknown): TreeRow => {
    const row: TreeRow = {
        id,
        field,
        value: getDisplayValue(value),
        type: getTypeName(value),
        isExpanded: false,
    };

    if (Array.isArray(value)) {
        const children: TreeRow[] = [];
        const arrayLength = Math.min(value.length, MAX_TREE_LEVEL_LENGTH);

        for (let i = 0; i < arrayLength; i++) {
            children.push(valueToTreeRow(`${id}-${leftPadIndex(i, arrayLength + 1)}`, `${i}`, value[i]));
        }

        if (value.length > MAX_TREE_LEVEL_LENGTH) {
            children.push({
                id: `${id}-${leftPadIndex(MAX_TREE_LEVEL_LENGTH + 1, arrayLength + 1)}`,
                field: '',
                value: l10n.t('Array is too large to be shown'),
                type: 'String',
            });
        }

        if (children.length > 0) {
            row.children = children;
        }
    } else if (value && typeof value === 'object') {
        const children: TreeRow[] = [];
        const sortedKeys = Object.keys(value).sort((a, b) => a.localeCompare(b));
        const objectLength = Math.min(sortedKeys.length, MAX_TREE_LEVEL_LENGTH);

        for (let i = 0; i < objectLength; i++) {
            const key = sortedKeys[i];
            children.push(
                valueToTreeRow(
                    `${id}-${leftPadIndex(i, objectLength + 1)}`,
                    key,
                    (value as Record<string, unknown>)[key],
                ),
            );
        }

        if (sortedKeys.length > MAX_TREE_LEVEL_LENGTH) {
            children.push({
                id: `${id}-${leftPadIndex(MAX_TREE_LEVEL_LENGTH + 1, objectLength + 1)}`,
                field: '',
                value: l10n.t('Object is too large to be shown'),
                type: 'String',
            });
        }

        if (children.length > 0) {
            row.children = children;
        }
    }

    return row;
};

/**
 * Convert a document to a hierarchical TreeRow.
 * Caller must ensure the document is a plain object (not null / scalar / array).
 */
const documentToTreeRow = async (
    document: JSONObject,
    partitionKey: PartitionKeyDefinition | undefined,
    rootId: string,
): Promise<TreeRow> => {
    const headers = buildTableHeadersFromObjectDocuments([document], partitionKey, {
        ShowPartitionKey: 'first',
        ShowServiceColumns: 'last',
        Sorting: 'ascending',
        TruncateValues: MAX_TREE_LEVEL_LENGTH,
    });
    const partitionKeyValues = extractPartitionKeyValues(document, partitionKey);

    // Build children for all headers
    const children: TreeRow[] = [];
    for (let index = 0; index < headers.length; index++) {
        const header = headers[index];
        const value = header.startsWith('/') ? partitionKeyValues[header] : (document[header] as unknown);
        children.push(valueToTreeRow(`${rootId}-${leftPadIndex(index, headers.length)}`, header, value));

        // Yield to the event loop periodically to avoid UI freezes
        if (index % 500 === 0 && index > 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    // Return root document row with children
    return {
        id: rootId,
        documentId: getDocumentId(document, partitionKey),
        field:
            typeof document['id'] === 'string' && document['id']
                ? document['id']
                : `${rootId} (Index number, id is missing)`,
        value: '',
        type: 'Document',
        children: children.length > 0 ? children : undefined,
        isExpanded: false,
    };
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
 * @param documents  Result documents — `QueryResultRecord[]` i.e. `JSONValue[]`
 * @param partitionKey
 * @param options
 */
const buildTableHeadersFromObjectDocuments = (
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
                __id: uuid(),
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
            __id: uuid(),
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

export const queryMetricsToTable = (queryResult: SerializedQueryResult | null): Promise<StatsItem[]> => {
    if (!queryResult || queryResult?.queryMetrics === undefined) {
        return Promise.resolve([]);
    }

    const { queryMetrics, iteration, metadata } = queryResult;
    const documentsCount = queryResult.documents?.length ?? 0;
    const countPerPage = metadata.countPerPage ?? 100;

    const recordsCount =
        countPerPage === -1
            ? documentsCount
                ? `0 - ${documentsCount}`
                : l10n.t('All')
            : `${(iteration - 1) * countPerPage} - ${iteration * countPerPage}`;

    const stats: StatsItem[] = [
        {
            metric: l10n.t('Request Charge', { comment: 'Cosmos DB metrics' }),
            value: queryResult.requestCharge,
            formattedValue: `${queryResult.requestCharge} RUs`,
            tooltip: l10n.t('Request Charge', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Showing Results', { comment: 'Cosmos DB metrics' }),
            value: recordsCount,
            formattedValue: recordsCount,
            tooltip: l10n.t('Showing Results', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Retrieved document count', { comment: 'Cosmos DB metrics' }),
            value: queryResult.documents?.length ?? 0,
            formattedValue: `${queryResult.documents?.length ?? 0}`,
            tooltip: l10n.t('Total number of retrieved documents', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Retrieved document size', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.retrievedDocumentSize ?? 0,
            formattedValue: `${queryMetrics.retrievedDocumentSize ?? 0} bytes`,
            tooltip: l10n.t('Total size of retrieved documents in bytes', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Output document count', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.outputDocumentCount ?? 0,
            formattedValue: `${queryMetrics.outputDocumentCount ?? ''}`,
            tooltip: l10n.t('Number of output documents', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Output document size', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.outputDocumentSize ?? 0,
            formattedValue: `${queryMetrics.outputDocumentSize ?? 0} bytes`,
            tooltip: l10n.t('Total size of output documents in bytes', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Index hit document count', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.indexHitDocumentCount ?? 0,
            formattedValue: `${queryMetrics.indexHitDocumentCount ?? ''}`,
            tooltip: l10n.t('Total number of documents matched by the filter', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Index lookup time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.indexLookupTime ?? 0,
            formattedValue: `${queryMetrics.indexLookupTime ?? 0} ms`,
            tooltip: l10n.t('Time spent in physical index layer', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Document load time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.documentLoadTime ?? 0,
            formattedValue: `${queryMetrics.documentLoadTime ?? 0} ms`,
            tooltip: l10n.t('Time spent in loading documents', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Query engine execution time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.runtimeExecutionTimes.queryEngineExecutionTime ?? 0,
            formattedValue: `${queryMetrics.runtimeExecutionTimes.queryEngineExecutionTime ?? 0} ms`,
            tooltip: l10n.t(
                'Time spent by the query engine to execute the query expression (excludes other execution times like load documents or write results)',
                { comment: 'Cosmos DB metrics' },
            ),
        },
        {
            metric: l10n.t('System function execution time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.runtimeExecutionTimes.systemFunctionExecutionTime ?? 0,
            formattedValue: `${queryMetrics.runtimeExecutionTimes.systemFunctionExecutionTime ?? 0} ms`,
            tooltip: l10n.t('Total time spent executing system (built-in) functions', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('User defined function execution time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.runtimeExecutionTimes.userDefinedFunctionExecutionTime ?? 0,
            formattedValue: `${queryMetrics.runtimeExecutionTimes.userDefinedFunctionExecutionTime ?? 0} ms`,
            tooltip: l10n.t('Total time spent executing user-defined functions', { comment: 'Cosmos DB metrics' }),
        },
        {
            metric: l10n.t('Document write time', { comment: 'Cosmos DB metrics' }),
            value: queryMetrics.documentWriteTime ?? 0,
            formattedValue: `${queryMetrics.documentWriteTime ?? 0} ms`,
            tooltip: l10n.t('Time spent to write query result set to response buffer', {
                comment: 'Cosmos DB metrics',
            }),
        },
    ];

    if (queryResult.roundTrips) {
        stats.push({
            metric: l10n.t('Round Trips'),
            value: queryResult.roundTrips,
            formattedValue: `${queryResult.roundTrips}`,
            tooltip: l10n.t('Number of round trips'),
        });
    }
    if (queryResult.activityId) {
        stats.push({
            metric: l10n.t('Activity id'),
            value: queryResult.activityId,
            formattedValue: `${queryResult.activityId}`,
            tooltip: '',
        });
    }

    return Promise.resolve(stats);
};

export const indexMetricsToTableItem = (queryResult: SerializedQueryResult): StatsItem => {
    return {
        metric: l10n.t('Index Metrics'),
        value: queryResult.indexMetrics.trim(),
        formattedValue: queryResult.indexMetrics.trim(),
        tooltip: '',
    };
};

export const queryMetricsToJSON = async (queryResult: SerializedQueryResult | null): Promise<string> => {
    if (!queryResult) {
        return '';
    }

    const stats = await queryMetricsToTable(queryResult);

    stats.push(indexMetricsToTableItem(queryResult));

    return JSON.stringify(stats, null, 4);
};
