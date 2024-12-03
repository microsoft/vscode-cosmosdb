/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type PartitionKeyDefinition } from '@azure/cosmos';
import { v4 as uuid } from 'uuid';
import { type QueryResultRecord, type SerializedQueryResult } from '../docdb/types/queryResult';
import { extractPartitionKey } from './document';
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
    deletedRows: number[];
};

/**
 * We can retrieve the document id to open it in a separate tab only if record contains CosmosDbRecordIdentifier
 * We can be 100% sure that all required fields for CosmosDbRecordIdentifier are present in the record
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

export const queryResultToJSON = (queryResult: SerializedQueryResult | null, selection?: number[]) => {
    if (!queryResult) {
        return '';
    }

    const notDeletedRows = queryResult.documents
        .map((_, index) => index)
        .filter((index) => !queryResult.deletedDocuments.includes(index));
    const selectedRows = selection ? notDeletedRows.filter((index) => selection.includes(index)) : notDeletedRows;
    const selectedDocs = queryResult.documents.filter((_, index) => selectedRows.includes(index));

    return JSON.stringify(selectedDocs, null, 4);
};

export const queryResultToTree = (
    queryResult: SerializedQueryResult | null,
    partitionKey: PartitionKeyDefinition | undefined,
): TreeData[] => {
    const tree: TreeData[] = [];

    if (!queryResult) {
        return tree;
    }

    queryResult.documents.forEach((doc, index) => {
        const documentTree = documentToSlickGridTree(doc, partitionKey, index, `${index}-`);
        tree.push(...documentTree);
    });

    return tree;
};

const documentToSlickGridTree = (
    document: QueryResultRecord,
    _partitionKey: PartitionKeyDefinition | undefined, // TODO: To show id and partition key fields upper than the other fields
    index: number,
    idPrefix?: string,
): TreeData[] => {
    const tree: TreeData[] = [];

    let localEntryId = 0; // starts with 0 on each document
    if (idPrefix === undefined || idPrefix === null) {
        idPrefix = uuid();
    }

    const rootId = `${idPrefix}-${localEntryId}`; // localEntryId is always a 0 here
    tree.push({
        id: rootId,
        field: document['id'] ? `${document['id']}` : `${index + 1} (Index number, id is missing)`,
        value: '',
        type: 'Document',
        parentId: null,
    });

    const stack: { key: string; value: unknown; parentId: string | null }[] = Object.entries(document).map(
        ([key, value]) => ({
            parentId: rootId,
            key: key,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the value can be anything here as it comes from a MongoDB document
            value: value,
        }),
    );

    while (stack.length > 0) {
        localEntryId++;
        const globalEntryId = `${idPrefix}-${localEntryId}`; // combines the global prefix with the local id

        const stackEntry = stack.pop();
        if (!stackEntry) {
            continue;
        }

        if (typeof stackEntry.value === 'string') {
            tree.push({
                id: globalEntryId,
                field: `${stackEntry.key}`,
                value: `${stackEntry.value}`,
                type: 'String',
                parentId: stackEntry.parentId,
            });
        } else if (typeof stackEntry.value === 'number') {
            tree.push({
                id: globalEntryId,
                field: `${stackEntry.key}`,
                value: `${stackEntry.value}`,
                type: 'Number',
                parentId: stackEntry.parentId,
            });
        } else if (typeof stackEntry.value === 'boolean') {
            tree.push({
                id: globalEntryId,
                field: `${stackEntry.key}`,
                value: `${stackEntry.value}`,
                type: 'Boolean',
                parentId: stackEntry.parentId,
            });
        } else if (stackEntry.value === null) {
            tree.push({
                id: globalEntryId,
                field: `${stackEntry.key}`,
                value: 'null',
                type: 'Null',
                parentId: stackEntry.parentId,
            });
        } else if (stackEntry.value && typeof stackEntry.value === 'object') {
            tree.push({
                id: globalEntryId,
                field: `${stackEntry.key}`,
                value: `{...}`,
                type: 'Object',
                parentId: stackEntry.parentId,
            });

            // Add the properties of the object to the stack
            Object.entries(stackEntry.value).map(([key, value]) => {
                stack.push({ key: `${key}`, value: value, parentId: globalEntryId });
            });
        } else if (stackEntry.value instanceof Array) {
            tree.push({
                id: globalEntryId,
                field: `${stackEntry.key}`,
                value: `(elements: ${stackEntry.value.length})`,
                type: 'Array',
                parentId: stackEntry.parentId,
            });

            // Add the elements of the array to the stack
            stackEntry.value.forEach((element, i) => {
                stack.push({ key: `${i}`, value: element, parentId: globalEntryId });
            });
        }
    }

    return tree;
};

/**
 * Get the headers for the table (don't take into account the nested objects)
 * The id is always the first column (if it does not exist in partition key),
 * then the partition key, when each column has / prefix,
 * then the user columns without _ prefix,
 * then the service columns with _ prefix
 * @param documents
 * @param partitionKey
 */
export const getTableHeadersWithRecordIdentifyColumns = (
    documents: ItemDefinition[],
    partitionKey: PartitionKeyDefinition | undefined,
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

    // Remove duplicates while keeping order
    const uniqueHeaders = new Set<string>([...partitionKeyPaths, ...columns, ...serviceColumns]);
    return Array.from(uniqueHeaders);
};

/**
 * Get the dataset for the table (don't take into account the nested objects)
 * Uses __id as the unique id of the document
 * Includes the nested partition key values as columns
 * @param documents
 * @param partitionKey
 */
export const getTableDatasetWithRecordIdentifyColumns = (
    documents: QueryResultRecord[],
    partitionKey: PartitionKeyDefinition | undefined,
): TableRecord[] => {
    const result = new Array<TableRecord>();

    documents.forEach((doc) => {
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
            if (value !== null && typeof value === 'object') {
                row[key] = JSON.stringify(value);
            } else if (doc[key] instanceof Array) {
                row[key] = `(elements: ${doc[key].length})`;
            } else {
                row[key] = `${doc[key]}`;
            }
        });

        result.push(row);
    });

    return result;
};

export const getTableHeaders = (documents: QueryResultRecord[]): string[] => {
    const keys = new Set<string>();

    documents.forEach((doc) => {
        Object.keys(doc).forEach((key) => {
            keys.add(key);
        });
    });

    return Array.from(keys);
};

export const getTableDataset = (documents: QueryResultRecord[]): TableRecord[] => {
    const result = new Array<TableRecord>();

    documents.forEach((doc) => {
        const row: TableRecord = { __id: uuid() };

        Object.entries(doc).forEach(([key, value]) => {
            if (value !== null && typeof value === 'object') {
                row[key] = JSON.stringify(value);
            } else if (doc[key] instanceof Array) {
                row[key] = `(elements: ${doc[key].length})`;
            } else {
                row[key] = `${doc[key]}`;
            }
        });

        result.push(row);
    });

    return result;
};

/**
 * Prepare the table data from the query result
 * @param queryResult
 * @param partitionKey
 * @param reorderColumns If true, the columns will be reordered as the id + partitionKey + user columns + service columns
 *                       If false, the columns will be in the order they are in the query result
 * @param showServiceColumns If true, the service columns will be shown
 */
export const queryResultToTable = (
    queryResult: SerializedQueryResult | null,
    partitionKey: PartitionKeyDefinition | undefined,
    reorderColumns?: boolean,
    showServiceColumns?: boolean,
): TableData => {
    let result: TableData = { headers: [], dataset: [], deletedRows: [] };

    if (!queryResult) {
        return result;
    }

    if (isSelectStar(queryResult.query ?? '')) {
        reorderColumns = true;
        showServiceColumns = showServiceColumns ?? true;
    }

    if (reorderColumns) {
        result = {
            headers: getTableHeadersWithRecordIdentifyColumns(queryResult.documents, partitionKey),
            dataset: getTableDatasetWithRecordIdentifyColumns(queryResult.documents, partitionKey),
            deletedRows: queryResult.deletedDocuments,
        };
    } else {
        result = {
            headers: getTableHeaders(queryResult.documents),
            dataset: getTableDataset(queryResult.documents),
            deletedRows: queryResult.deletedDocuments,
        };
    }

    if (!showServiceColumns) {
        result.headers = result.headers.filter((header) => !header.startsWith('_'));
    }

    return result;
};

export const queryMetricsToTable = (queryResult: SerializedQueryResult | null): StatsItem[] => {
    if (!queryResult || queryResult?.queryMetrics === undefined) {
        return [];
    }

    const { queryMetrics, iteration, metadata } = queryResult;
    const countPerPage = metadata.countPerPage ?? 100;

    const stats: StatsItem[] = [
        {
            metric: 'Request Charge',
            value: queryResult.requestCharge,
            formattedValue: `${queryResult.requestCharge} RUs`,
            tooltip: 'Request Charge',
        },
        {
            metric: 'Showing Results',
            value: `${(iteration - 1) * countPerPage} - ${iteration * countPerPage}`,
            formattedValue: `${(iteration - 1) * countPerPage} - ${iteration * countPerPage}`,
            tooltip: 'Showing Results',
        },
        {
            metric: 'Retrieved document count',
            value: queryResult.documents?.length ?? 0,
            formattedValue: `${queryResult.documents?.length ?? 0}`,
            tooltip: 'Total number of retrieved documents',
        },
        {
            metric: 'Retrieved document size',
            value: queryMetrics.retrievedDocumentSize ?? 0,
            formattedValue: `${queryMetrics.retrievedDocumentSize ?? 0} bytes`,
            tooltip: 'Total size of retrieved documents in bytes',
        },
        {
            metric: 'Output document count',
            value: queryMetrics.outputDocumentCount ?? 0,
            formattedValue: `${queryMetrics.outputDocumentCount ?? ''}`,
            tooltip: 'Number of output documents',
        },
        {
            metric: 'Output document size',
            value: queryMetrics.outputDocumentSize ?? 0,
            formattedValue: `${queryMetrics.outputDocumentSize ?? 0} bytes`,
            tooltip: 'Total size of output documents in bytes',
        },
        {
            metric: 'Index hit document count',
            value: queryMetrics.indexHitDocumentCount ?? 0,
            formattedValue: `${queryMetrics.indexHitDocumentCount ?? ''}`,
            tooltip: 'Total number of documents matched by the filter',
        },
        {
            metric: 'Index lookup time',
            value: queryMetrics.indexLookupTime ?? 0,
            formattedValue: `${queryMetrics.indexLookupTime ?? 0} ms`,
            tooltip: 'Time spent in physical index layer',
        },
        {
            metric: 'Document load time',
            value: queryMetrics.documentLoadTime ?? 0,
            formattedValue: `${queryMetrics.documentLoadTime ?? 0} ms`,
            tooltip: 'Time spent in loading documents',
        },
        {
            metric: 'Query engine execution time',
            value: queryMetrics.runtimeExecutionTimes.queryEngineExecutionTime ?? 0,
            formattedValue: `${queryMetrics.runtimeExecutionTimes.queryEngineExecutionTime ?? 0} ms`,
            tooltip:
                'Time spent by the query engine to execute the query expression (excludes other execution times like load documents or write results)',
        },
        {
            metric: 'System function execution time',
            value: queryMetrics.runtimeExecutionTimes.systemFunctionExecutionTime ?? 0,
            formattedValue: `${queryMetrics.runtimeExecutionTimes.systemFunctionExecutionTime ?? 0} ms`,
            tooltip: 'Total time spent executing system (built-in) functions',
        },
        {
            metric: 'User defined function execution time',
            value: queryMetrics.runtimeExecutionTimes.userDefinedFunctionExecutionTime ?? 0,
            formattedValue: `${queryMetrics.runtimeExecutionTimes.userDefinedFunctionExecutionTime ?? 0} ms`,
            tooltip: 'Total time spent executing user-defined functions',
        },
        {
            metric: 'Document write time',
            value: queryMetrics.documentWriteTime ?? 0,
            formattedValue: `${queryMetrics.documentWriteTime ?? 0} ms`,
            tooltip: 'Time spent to write query result set to response buffer',
        },
    ];

    if (queryResult.roundTrips) {
        stats.push({
            metric: 'Round Trips',
            value: queryResult.roundTrips,
            formattedValue: `${queryResult.roundTrips}`,
            tooltip: 'Number of round trips',
        });
    }
    if (queryResult.activityId) {
        stats.push({
            metric: 'Activity id',
            value: queryResult.activityId,
            formattedValue: `${queryResult.activityId}`,
            tooltip: '',
        });
    }

    return stats;
};

const indexMetricsToTableItem = (queryResult: SerializedQueryResult): StatsItem => {
    return {
        metric: 'Index Metrics',
        value: queryResult.indexMetrics.trim(),
        formattedValue: queryResult.indexMetrics.trim(),
        tooltip: '',
    };
};

export const queryMetricsToJSON = (queryResult: SerializedQueryResult | null): string => {
    if (!queryResult) {
        return '';
    }

    const stats = queryMetricsToTable(queryResult);

    stats.push(indexMetricsToTableItem(queryResult));

    return JSON.stringify(stats, null, 4);
};

export const escapeCsvValue = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }

    return value;
};

export const queryMetricsToCsv = (queryResult: SerializedQueryResult | null): string => {
    if (!queryResult) {
        return '';
    }

    const stats = queryMetricsToTable(queryResult);

    stats.push(indexMetricsToTableItem(queryResult));

    const titles = stats.map((item) => item.metric).join(',');
    const values = stats.map((item) => escapeCsvValue(item.value.toString())).join(',');
    return `${titles}\n${values}`;
};

export const queryResultToCsv = (
    queryResult: SerializedQueryResult | null,
    partitionKey?: PartitionKeyDefinition,
    selection?: number[],
): string => {
    if (!queryResult) {
        return '';
    }

    const tableView = queryResultToTable(queryResult, partitionKey);
    const headers = tableView.headers.join(',');

    const notDeletedRows = tableView.dataset
        .map((_, index) => index)
        .filter((index) => !tableView.deletedRows.includes(index));
    const selectedRows = selection ? notDeletedRows.filter((index) => selection.includes(index)) : notDeletedRows;

    tableView.dataset = tableView.dataset.filter((_, index) => selectedRows.includes(index));

    const rows = tableView.dataset
        .map((row) => {
            const rowValues: string[] = [];

            tableView.headers.forEach((header) => {
                if (header.startsWith('/')) {
                    header = header.slice(1);
                }

                const value = row[header] ?? '';
                rowValues.push(escapeCsvValue(value));
            });

            return rowValues.join(',');
        })
        .join('\n');
    return `${headers}\n${rows}`;
};
