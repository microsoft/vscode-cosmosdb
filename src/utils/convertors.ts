/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type JSONValue,
    type PartitionKey,
    type PartitionKeyDefinition,
    type PrimitivePartitionKeyValue,
} from '@azure/cosmos';
import { type CosmosDbRecord, type SerializedQueryResult } from '../docdb/types/queryResult';
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

export const extractPartitionKey = (document: CosmosDbRecord, partitionKey: PartitionKeyDefinition): PartitionKey => {
    return partitionKey.paths.map((path): PrimitivePartitionKeyValue => {
        let interim: JSONValue = document;
        const partitionKeyPath = path.split('/').filter((key) => key !== '');

        for (const prop of partitionKeyPath) {
            if (interim && typeof interim === 'object' && interim[prop]) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                interim = interim[prop];
            } else {
                return null; // It is not correct to return null, in other cases it should exception
            }
        }
        if (
            interim === null ||
            typeof interim === 'string' ||
            typeof interim === 'number' ||
            typeof interim === 'boolean'
        ) {
            return interim;
        }

        return null; // It is not correct to return null, in other cases it should exception
    });
};

export const getDocumentId = (document: CosmosDbRecord, partitionKey: PartitionKeyDefinition | undefined): string => {
    // The real unique id of the document is stored in the '_rid' field
    if (document['_rid']) {
        return `${document['_rid']}`;
    } else if (partitionKey) {
        // Next unique id is the partition key + id
        const partitionKeyValue = extractPartitionKey(document, partitionKey);
        if (Array.isArray(partitionKeyValue)) {
            return `${partitionKeyValue.join('-')}-${document.id}`;
        }

        return `${partitionKeyValue}-${document.id}`;
    } else {
        // Last resort is just the id
        return `${document.id}`;
    }
};

export const queryResultToJSON = (queryResult: SerializedQueryResult | null) => {
    if (!queryResult) {
        return '';
    }

    return JSON.stringify(queryResult.documents, null, 4);
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
    document: CosmosDbRecord,
    partitionKey: PartitionKeyDefinition | undefined,
    index: number,
    idPrefix?: string,
): TreeData[] => {
    const tree: TreeData[] = [];

    let localEntryId = 0; // starts with 0 on each document
    if (idPrefix === undefined || idPrefix === null) {
        idPrefix = getDocumentId(document as CosmosDbRecord, partitionKey);
    }

    const rootId = `${idPrefix}${localEntryId}`; // localEntryId is always a 0 here
    tree.push({
        id: rootId,
        field: document['id'] ? `${document['id']}` : `${index + 1}`,
        value: '{...}',
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
        const globalEntryId = `${idPrefix}${localEntryId}`; // combines the global prefix with the local id

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
 * TODO: Need to take into account the order of columns what user used in the query
 * @param documents
 * @param partitionKey
 */
export const getTableHeaders = (
    documents: CosmosDbRecord[],
    partitionKey: PartitionKeyDefinition | undefined,
): string[] => {
    const keys = new Set<string>();
    const serviceKeys = new Set<string>();

    documents.forEach((doc) => {
        Object.keys(doc).forEach((key) => {
            if (key === 'id') {
                //skip id
            } else if (key.startsWith('_')) {
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

    return [...partitionKeyPaths, ...columns, ...serviceColumns];
};

/**
 * Get the dataset for the table (don't take into account the nested objects)
 * Uses __id as the unique id of the document
 * Includes the nested partition key values as columns
 * @param documents
 * @param partitionKey
 */
export const getTableDataset = (
    documents: CosmosDbRecord[],
    partitionKey: PartitionKeyDefinition | undefined,
): TableRecord[] => {
    const result = new Array<TableRecord>();

    documents.forEach((doc) => {
        // Emulate the unique id of the document
        const row: TableRecord = { __id: getDocumentId(doc, partitionKey) };

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

export const queryResultToTable = (
    queryResult: SerializedQueryResult | null,
    partitionKey: PartitionKeyDefinition | undefined,
): TableData => {
    if (!queryResult) {
        return {
            headers: [],
            dataset: [],
        };
    }

    return {
        headers: getTableHeaders(queryResult.documents, partitionKey),
        dataset: getTableDataset(queryResult.documents, partitionKey),
    };
};

export const queryMetricsToTable = (queryResult: SerializedQueryResult | null): StatsItem[] => {
    if (!queryResult) {
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

export const queryMetricsToJSON = (queryResult: SerializedQueryResult | null): string => {
    if (!queryResult) {
        return '';
    }

    return JSON.stringify(queryMetricsToTable(queryResult), null, 4);
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
    const titles = stats.map((item) => item.metric).join(',');
    const values = stats.map((item) => escapeCsvValue(item.value.toString())).join(',');
    return `${titles}\n${values}`;
};

export const queryResultToCsv = (
    queryResult: SerializedQueryResult | null,
    partitionKey?: PartitionKeyDefinition,
): string => {
    if (!queryResult) {
        return '';
    }

    const tableView = queryResultToTable(queryResult, partitionKey);
    const headers = tableView.headers.join(',');
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
