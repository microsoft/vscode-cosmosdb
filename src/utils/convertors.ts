/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * NOTE: Mostly of these functions are async to be able to move them to backend in the future
 */

import { type ItemDefinition, type PartitionKeyDefinition } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
import { v4 as uuid } from 'uuid';
import { type QueryResultRecord, type SerializedQueryResult } from '../cosmosdb/types/queryResult';
import { extractPartitionKey, extractPartitionKeyValues } from './document';
import { type TreeData } from './slickgrid/mongo/toSlickGridTree';

export type StatsItem = {
    metric: string;
    value: string | number;
    formattedValue: string;
    tooltip: string;
};

export type TableRecord = Record<string, string> & { __id: string };
export type TableData = {
    headers: string[];
    dataset: TableRecord[];
};

export type ColumnOptions = {
    ShowPartitionKey: 'first' | 'none'; // 'first' = show id + partition key first, 'none' = the nested partition key values are hidden + partition key are shown as is (without / prefix)
    ShowServiceColumns: 'last' | 'none'; // 'last' = show service columns last, 'none' = hide service columns
    Sorting: 'ascending' | 'descending' | 'none'; // 'ascending' = sort columns in ascending order, 'descending' = sort columns in descending order, 'none' = no sorting
    TruncateValues: number; // truncate values to this length, 0 = no truncation
};

type StackEntry = {
    id: string;
    key: string;
    value: unknown;
    parentId: string | null;
};

const MAX_TREE_LEVEL_LENGTH = 100;

/**
 * Truncates a string if it exceeds the specified maximum length.
 * @param value The string to truncate
 * @param maxLength Maximum length of the string (default: MAX_TREE_LEVEL_LENGTH)
 * @param suffix Suffix to append to truncated strings (default: "…")
 * @returns The truncated string with suffix if truncated, or original string
 */
export const truncateString = (value: string, maxLength = MAX_TREE_LEVEL_LENGTH, suffix = '…'): string => {
    if (!value) {
        return '';
    }

    if (value.length <= maxLength) {
        return value;
    }

    return value.substring(0, maxLength - suffix.length) + suffix;
};

/**
 * Creates a left-padded string representation of an index based on array length
 * @param {number} index - The index to pad
 * @param {Array|number} array - The array or its length to determine padding width
 * @param {string} [padChar='0'] - Character to use for padding
 * @returns {string} - Padded index string
 */
function leftPadIndex(index: number, array: unknown[] | number, padChar: string = '0'): string {
    // Get array length or use the number directly
    const arrayLength = Array.isArray(array) ? array.length : array;

    // Calculate the number of digits needed
    const maxDigits = Math.floor(Math.log10(arrayLength - 1) + 1);

    // Convert index to string and add padding
    return String(index).padStart(maxDigits, padChar);
}

/**
 * We can retrieve the document id to open it in a separate tab only if record contains {@link CosmosDBRecordIdentifier}
 * We can be 100% sure that all required fields for {@link CosmosDBRecordIdentifier} are present in the record
 * if query has `SELECT *` clause. So we can enable editing only in this case.
 * Based on documentation https://learn.microsoft.com/en-us/azure/cosmos-db/nosql/query/select
 * '*" is allowed only if the query doesn't have any subset or joins
 * @param query
 */
export const isSelectStar = (query: string): boolean => {
    const matches = query.match(/select([\S\s]*)from[\s\S]*$/im);
    if (matches) {
        const selectClause = matches[1].split(',').map((s) => s.trim());
        return selectClause.find((s) => s.endsWith('*')) !== undefined;
    }

    return false;
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
): Promise<TreeData[]> => {
    const tree: TreeData[] = [];

    if (!queryResult) {
        return tree;
    }

    const docsLength = queryResult.documents.length;
    for (let i = 0; i < docsLength; i++) {
        const doc = queryResult.documents[i];
        const documentTree = await documentToSlickGridTree(doc, partitionKey, leftPadIndex(i, docsLength));
        documentTree.forEach((doc) => tree.push(doc));
    }

    return tree;
};

const stackEntryToSlickGridTree = (entry: StackEntry): TreeData => {
    const entryType = typeof entry.value;
    const type =
        entryType === null
            ? 'Null'
            : entryType === 'string'
              ? 'String'
              : entryType === 'number'
                ? 'Number'
                : entryType === 'boolean'
                  ? 'Boolean'
                  : Array.isArray(entry.value)
                    ? 'Array'
                    : entryType === 'object'
                      ? 'Object'
                      : entryType.charAt(0).toUpperCase() + entryType.slice(1);

    const value = Array.isArray(entry.value)
        ? `(elements: ${entry.value.length})`
        : entry.value === null
          ? 'null'
          : typeof entry.value === 'object'
            ? '{...}'
            : `${entry.value}`;

    return {
        id: entry.id,
        field: `${entry.key}`,
        value,
        type,
        parentId: entry.parentId,
    };
};

const documentToSlickGridTree = async (
    document: QueryResultRecord,
    partitionKey: PartitionKeyDefinition | undefined,
    rootId: string,
): Promise<TreeData[]> => {
    const tree: TreeData[] = [];

    const headers = getTableHeaders([document], partitionKey, {
        ShowPartitionKey: 'first',
        ShowServiceColumns: 'last',
        Sorting: 'ascending',
        TruncateValues: MAX_TREE_LEVEL_LENGTH,
    });
    const partitionKeyValues = extractPartitionKeyValues(document, partitionKey);
    const stack: { id: string; key: string; value: unknown; parentId: string | null }[] = [];

    // Add the document as the root element for the tree
    tree.push({
        id: rootId,
        field: document['id'] ? `${document['id']}` : `${rootId} (Index number, id is missing)`,
        value: '',
        type: 'Document',
        parentId: null,
    });

    headers.forEach((header, index) => {
        stack.push({
            id: `${rootId}-${leftPadIndex(index, headers.length)}`,
            parentId: rootId,
            key: header,
            value: header.startsWith('/') ? partitionKeyValues[header] : document[header],
        });
    });

    const chunkSize = 1000; // Process 1000 stack entries per chunk
    while (stack.length > 0) {
        const chunk = stack.splice(0, Math.min(chunkSize, stack.length));

        for (const stackEntry of chunk) {
            const treeElement = stackEntryToSlickGridTree(stackEntry);
            tree.push(treeElement);

            if (Array.isArray(stackEntry.value)) {
                const arrayLength = Math.min(stackEntry.value.length, MAX_TREE_LEVEL_LENGTH);

                // Add the elements of the array to the stack
                for (let i = 0; i < arrayLength; i++) {
                    stack.push({
                        id: `${stackEntry.id}-${leftPadIndex(i, arrayLength + 1)}`,
                        key: `${i}`,
                        value: stackEntry.value[i],
                        parentId: stackEntry.id,
                    });
                }

                // If the array is too large, add a placeholder
                if (stackEntry.value.length > MAX_TREE_LEVEL_LENGTH) {
                    stack.push({
                        id: `${stackEntry.id}-${leftPadIndex(MAX_TREE_LEVEL_LENGTH + 1, arrayLength + 1)}`,
                        key: '',
                        value: 'Array is too large to be shown',
                        parentId: stackEntry.id,
                    });
                }
            } else if (stackEntry.value && typeof stackEntry.value === 'object') {
                const sortedKeys = Object.keys(stackEntry.value).sort((a, b) => a.localeCompare(b));
                const objectLength = Math.min(sortedKeys.length, MAX_TREE_LEVEL_LENGTH);

                // Add the properties of the object to the stack
                for (let i = 0; i < objectLength; i++) {
                    stack.push({
                        id: `${stackEntry.id}-${leftPadIndex(i, objectLength + 1)}`,
                        key: sortedKeys[i],
                        value: stackEntry.value[sortedKeys[i]],
                        parentId: stackEntry.id,
                    });
                }

                // If the object is too large, add a placeholder
                if (sortedKeys.length > MAX_TREE_LEVEL_LENGTH) {
                    stack.push({
                        id: `${stackEntry.id}-${leftPadIndex(MAX_TREE_LEVEL_LENGTH + 1, objectLength + 1)}`,
                        key: '',
                        value: 'Object is too large to be shown',
                        parentId: stackEntry.id,
                    });
                }
            }
        }

        // Yield to the event loop after processing each chunk
        if (stack.length > 0) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    return tree;
};

/**
 * Get the headers for the table (don't take into account the nested objects)
 * @param documents
 * @param partitionKey
 * @param options
 */
export const getTableHeaders = (
    documents: ItemDefinition[],
    partitionKey: PartitionKeyDefinition | undefined,
    options: ColumnOptions,
): string[] => {
    const keys = new Set<string>();
    const serviceKeys = new Set<string>();

    documents.forEach((doc) => {
        Object.keys(doc).forEach((key) => {
            if (key.startsWith('_')) {
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
 * Get the dataset for the table (don't take into account the nested objects)
 * Uses __id as the unique id of the document
 * Includes the nested partition key values as columns
 * @param documents
 * @param partitionKey
 * @param options
 */
export const getTableDataset = async (
    documents: QueryResultRecord[],
    partitionKey: PartitionKeyDefinition | undefined,
    options: ColumnOptions,
): Promise<TableRecord[]> => {
    const result = new Array<TableRecord>();
    const truncateValues = options.TruncateValues > 0;

    // Process documents in chunks to avoid UI freezes
    const chunkSize = 1000; // Process 1000 documents per chunk
    for (let i = 0; i < documents.length; i += chunkSize) {
        // Create a slice of documents to process in this batch
        const chunk = documents.slice(i, i + chunkSize);

        // Process each document in the chunk
        chunk.forEach((doc) => {
            // Emulate the unique id of the document
            const row: TableRecord = { __id: uuid() };

            if (partitionKey) {
                const partitionKeyPaths = (partitionKey?.paths ?? []).map((path) =>
                    path.startsWith('/') ? path.slice(1) : path,
                );
                const partitionKeyValues = extractPartitionKey(doc, partitionKey) ?? [];
                partitionKeyPaths.forEach((path, index) => {
                    row[path] = `${partitionKeyValues[index] ?? ''}`;
                });
            }

            Object.entries(doc).forEach(([key, value]) => {
                if (value instanceof Array) {
                    row[key] = truncateValues ? `(elements: ${value.length})` : JSON.stringify(value);
                } else if (value !== null && typeof value === 'object') {
                    row[key] = truncateValues
                        ? truncateString(JSON.stringify(value), options.TruncateValues)
                        : JSON.stringify(value);
                } else {
                    row[key] = truncateValues ? truncateString(`${value}`, options.TruncateValues) : `${value}`;
                }
            });

            result.push(row);
        });

        // Yield to the event loop after each chunk by using setTimeout with 0ms
        if (i + chunkSize < documents.length) {
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    return result;
};

/**
 * Prepare the table data from the query result
 * @param queryResult
 * @param partitionKey
 * @param options
 * Default options are:
 * The id is always the first column (if it does not exist in partition key),
 * then the partition key, when each column has / prefix,
 * then the user columns without _ prefix,
 * then the service columns with _ prefix
 * then values will be truncated to MAX_TREE_LEVEL_LENGTH characters, arrays will be truncated to (elements: n)
 *
 * !Warning! If query has `SELECT *` clause, the id and partition key fields will be shown first despite the options
 */
export const queryResultToTable = async (
    queryResult: SerializedQueryResult | null,
    partitionKey: PartitionKeyDefinition | undefined,
    options: ColumnOptions = {
        ShowPartitionKey: 'first',
        ShowServiceColumns: 'last',
        Sorting: 'none',
        TruncateValues: MAX_TREE_LEVEL_LENGTH,
    },
): Promise<TableData> => {
    if (!queryResult || !queryResult.documents) {
        return { headers: [], dataset: [] };
    }

    if (isSelectStar(queryResult.query ?? '')) {
        // If the query is a SELECT *, we can show the id and partition key fields
        // and reorder the columns
        options.ShowPartitionKey = 'first';
    }

    const headers = getTableHeaders(queryResult.documents, partitionKey, options);
    const dataset = await getTableDataset(queryResult.documents, partitionKey, options);

    return { headers, dataset };
};

export const queryMetricsToTable = async (queryResult: SerializedQueryResult | null): Promise<StatsItem[]> => {
    if (!queryResult || queryResult?.queryMetrics === undefined) {
        return [];
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

    return stats;
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
