import { makeStyles } from '@fluentui/react-components';
import { Suspense, useMemo } from 'react';
import { type SerializedQueryResult } from '../../../docdb/types/queryResult';
import { type TreeData } from '../../../utils/slickgrid/mongo/toSlickGridTree';
import { DataViewPanelTable } from '../../vCore/collectionView/dataViewPanelTable';
import { DataViewPanelTree } from '../../vCore/collectionView/dataViewPanelTree';
import { useQueryEditorState } from '../QueryEditorContext';
import { DataViewPanelJSON } from './DataViewPanelJSON';
import { ResultTableViewToolbar } from './ResultTableViewToolbar';

const useClasses = makeStyles({
    toolbarContainer: {
        marginBottom: '10px',
    },
    monacoContainer: {
        marginTop: '10px',
        width: '100%',
        height: 'calc(100% - 50px)',
    },
    container: {
        height: '100%',
    },
});

const queryResultToJson = (queryResult: SerializedQueryResult | null) => {
    if (!queryResult) {
        return '';
    }

    return JSON.stringify(queryResult.documents, null, 4);
};

export function queryResultToTree(queryResult: SerializedQueryResult | null): TreeData[] {
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
}

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

const queryResultToTable = (queryResult: SerializedQueryResult | null) => {
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

export const ResultTab = () => {
    const classes = useClasses();

    const { tableViewMode, currentQueryResult } = useQueryEditorState();

    const jsonViewData = useMemo(() => queryResultToJson(currentQueryResult), [currentQueryResult]);
    const tableViewData = useMemo(() => queryResultToTable(currentQueryResult), [currentQueryResult]);
    const treeViewData = useMemo(() => queryResultToTree(currentQueryResult), [currentQueryResult]);

    return (
        <section className={classes.container}>
            <ResultTableViewToolbar></ResultTableViewToolbar>
            <div className={classes.monacoContainer}>
                <Suspense fallback={<div>Loading...</div>}>
                    {tableViewMode === 'Table' && (
                        <DataViewPanelTable
                            liveData={tableViewData!.dataset}
                            liveHeaders={tableViewData!.headers}></DataViewPanelTable>
                    )}
                    {tableViewMode === 'Tree' && (
                        <DataViewPanelTree
                            liveData={
                                (treeViewData ?? []) as unknown as { [key: string]: undefined }[]
                            }></DataViewPanelTree>
                    )}
                    {tableViewMode === 'JSON' && (
                        <DataViewPanelJSON value={jsonViewData || 'No result'}></DataViewPanelJSON>
                    )}
                </Suspense>
            </div>
        </section>
    );
};
