import { type SerializedQueryResult } from '../../docdb/types/queryResult';
import { type TreeData } from '../../utils/slickgrid/mongo/toSlickGridTree';

export type StatsItem = {
    metric: string;
    value: string | number;
    formattedValue: string;
    tooltip: string;
};

export const queryResultToJson = (queryResult: SerializedQueryResult | null) => {
    if (!queryResult) {
        return '';
    }

    return JSON.stringify(queryResult.documents, null, 4);
};

export const queryResultToTree = (queryResult: SerializedQueryResult | null): TreeData[] => {
    const tree: TreeData[] = [];

    if (!queryResult) {
        return tree;
    }

    queryResult.documents.forEach((doc, index) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        const documentTree = documentToSlickGridTree(doc, index, `${index}-`);
        tree.push(...documentTree);
    });

    return tree;
};

const documentToSlickGridTree = (document: object, index: number, idPrefix?: string): TreeData[] => {
    const tree: TreeData[] = [];

    let localEntryId = 0; // starts with 0 on each document
    if (idPrefix === undefined || idPrefix === null) {
        idPrefix = '';
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

            if (stackEntry.value.length <= 10) {
                // Add the elements of the array to the stack
                stackEntry.value.forEach((element, i) => {
                    stack.push({ key: `${i}`, value: element, parentId: globalEntryId });
                });
            }
        }
    }

    return tree;
};

export const queryResultToTable = (queryResult: SerializedQueryResult | null) => {
    // TODO: I don't think that it is good idea to generate new dataset
    //  since it causes performance issues and doubling the memory usage

    if (!queryResult) {
        return {
            headers: [],
            dataset: [],
        };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function getFieldsTopLevel(documents: any[]): string[] {
        const keys = new Set<string>();

        documents.forEach((doc) => {
            Object.keys(doc as object).forEach((key) => {
                keys.add(key);
            });
        });

        return Array.from(keys);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function getDataTopLevel(documents: any[]): object[] {
        const result = new Array<object>();
        documents.forEach((doc, i) => {
            const row = { id: `${i + 1}` };

            Object.keys(doc as object).forEach((key) => {
                if (key === 'id') {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment,@typescript-eslint/no-unsafe-member-access
                    row[key] = `${doc[key]}`;
                } else {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    if (doc[key] instanceof Array) {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                        row[key] = `(elements: ${doc[key].length})`;
                    } else {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                        row[key] = `${doc[key]}`;
                    }
                }
            });

            result.push(row);
        });

        return result;
    }

    return {
        headers: getFieldsTopLevel(queryResult.documents),
        dataset: getDataTopLevel(queryResult.documents),
    };
};

export const queryMetricsToTable = (queryResult: SerializedQueryResult | null): StatsItem[] => {
    if (!queryResult) {
        return [];
    }

    const { queryMetrics } = queryResult;
    const stats: StatsItem[] = [
        {
            metric: 'Request Charge',
            value: queryResult.requestCharge,
            formattedValue: `${queryResult.requestCharge} RUs`,
            tooltip: 'Request Charge',
        },
        { metric: 'Showing Results', value: 0, formattedValue: '0', tooltip: 'Showing Results' },
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

export const queryMetricsToCsv = (queryResult: SerializedQueryResult | null): string => {
    if (!queryResult) {
        return '';
    }

    const stats = queryMetricsToTable(queryResult);
    const titles = stats.map((item) => item.metric).join(',');
    const values = stats.map((item) => item.value).join(',');
    return `${titles}\n${values}`;
};

export const queryResultToCsv = (queryResult: SerializedQueryResult | null): string => {
    if (!queryResult) {
        return '';
    }

    const tableView = queryResultToTable(queryResult);
    const headers = tableView.headers.join(',');
    const rows = tableView.dataset.map((row) => Object.values(row).join(',')).join('\n');
    return `${headers}\n${rows}`;
};
