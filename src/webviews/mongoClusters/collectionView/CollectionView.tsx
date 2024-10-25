/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { Tab, TabList } from '@fluentui/react-components';
import { type JSX, useEffect, useRef, useState } from 'react';
import { type JSONSchema } from 'vscode-json-languageservice';
import { type TableDataEntry } from '../../../mongoClusters/MongoClusterSession';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import './collectionView.scss';
import {
    CollectionViewContext,
    type CollectionViewContextType,
    DefaultCollectionViewContext,
    Views,
} from './collectionViewContext';
import { DataViewPanelJSON } from './components/DataViewPanelJSON';
import { DataViewPanelTableV2 } from './components/DataViewPanelTableV2';
import { DataViewPanelTree } from './components/DataViewPanelTree';
import { QueryEditor } from './components/QueryEditor';
import { ToolbarDocumentManipulation } from './components/toolbar/ToolbarDocumentManipulation';
import { ToolbarMainView } from './components/toolbar/ToolbarMainView';
import { ToolbarViewNavigation } from './components/toolbar/ToolbarViewNavigation';
import { ViewSwitcher } from './components/toolbar/ViewSwitcher';

interface QueryResults {
    tableHeaders?: string[];
    tableData?: TableDataEntry[]; // 'x-objectid': string;
    tableCurrentPath?: string[];

    treeData?: { [key: string]: unknown }[];

    jsonDocuments?: string[];
}

export const CollectionView = (): JSX.Element => {
    /**
     * Use the configuration object to access the data passed to the webview at its creation.
     * Feel free to update the content of the object. It won't be synced back to the extension though.
     */
    //const configuration = useConfiguration<DocumentsViewWebviewConfigurationType>();

    /**
     * Use the `useTrpcClient` hook to get the tRPC client and an event target
     * for handling notifications from the extension.
     */
    const { trpcClient /** , vscodeEventTarget */ } = useTrpcClient();

    /**
     * Please note: using the context and states inside of closures can lead to stale data.
     *
     * Closures capture state at the time of the closure creation, and do not update when the state changes.
     * This can lead to unexpected and surprising bugs where the state is not updated as expected (or rather 'assumed').
     *
     * There are two ways I know to work around this:
     * 1. Use the useRef hook to store the state and access it in the closure.
     * 2. Define the closure inside the useEffect hook, so it captures the state at the time of the effect.
     *
     * We can't use 2 in this case, because we need to define the handleMessage function outside of the useEffect hook.
     * As it could happen that the message arrives while we're reconfiguring the event listener.
     *
     * We're using the useRef hook to store the state and access it in the closure.
     */

    // that's our current global context of the view
    const [currentContext, setCurrentContext] = useState<CollectionViewContextType>(DefaultCollectionViewContext);

    // that's the local view of query results
    // TODO: it's a potential data duplication in the end, consider moving it into the global context of the view
    const [currentQueryResults, setCurrentQueryResults] = useState<QueryResults>();

    // TODO: consider moving the following to a unified state object
    const [currentAutocompletionData, setCurrentAutocompletionData] = useState<JSONSchema | null>(null);

    // keep Refs updated with the current state
    const currentQueryResultsRef = useRef(currentQueryResults);
    const currentContextRef = useRef(currentContext);

    useEffect(() => {
        currentQueryResultsRef.current = currentQueryResults;
        currentContextRef.current = currentContext;
    }, [currentQueryResults, currentContext]);

    useEffect(() => {
        if (currentAutocompletionData !== null) {
            currentContext.queryEditor?.setJsonSchema(currentAutocompletionData);
        }
    }, [currentAutocompletionData]);

    /**
     * This is used to run the query. We control it by setting the query configuration
     * in the currentContext state. Whenever the query configuration changes,
     * we run the query.
     *
     * It helps us manage the query runs as the configuration changes from
     * within various controls (query panel, paging, etc.).
     */
    useEffect(() => {
        setCurrentContext((prev) => ({ ...prev, isLoading: true }));

        // 1. Run the query, this operation only acknowledges the request.
        //    Next we need to load the ones we need.
        trpcClient.mongoClusters.collectionView.runQuery
            .query({
                findQuery: currentContext.currrentQueryDefinition.queryText,
                pageNumber: currentContext.currrentQueryDefinition.pageNumber,
                pageSize: currentContext.currrentQueryDefinition.pageSize,
            })
            .then((_response) => {
                // 2. This is the time to update the auto-completion data
                //    Since now we do know more about the data returned from the query
                updateAutoCompletionData();

                // 3. Load the data for the current view
                getDataForView(currentContext.currentView);

                setCurrentContext((prev) => ({ ...prev, isLoading: false }));
            })
            .catch((_error) => {
                setCurrentContext((prev) => ({ ...prev, isLoading: false }));
            });
    }, [currentContext.currrentQueryDefinition]);

    useEffect(() => {
        if (currentContext.currentView === Views.TABLE && currentContext.currentViewState?.currentPath) {
            getDataForView(currentContext.currentView);
        }
    }, [currentContext.currentViewState?.currentPath]);

    const handleViewChanged = (_optionValue: string) => {
        let selection: Views;

        switch (_optionValue) {
            case 'Table View':
                selection = Views.TABLE;
                break;
            case 'Tree View':
                selection = Views.TREE;
                break;
            case 'JSON View':
                selection = Views.JSON;
                break;
            default:
                selection = Views.TABLE;
                break;
        }

        setCurrentContext((prev) => ({ ...prev, currentView: selection }));
        getDataForView(selection);
    };

    function getDataForView(selectedView: Views): void {
        switch (selectedView) {
            case Views.TABLE: {
                const path = currentContext.currentViewState?.currentPath ?? [];

                trpcClient.mongoClusters.collectionView.getCurrentPageAsTable
                    .query(path)
                    .then((result) => {
                        let tableHeaders: string[];

                        /*
                         * If the _id is not in the headers, we add it as the first column.
                         * This is a presentation detail, not a data detail, that's why it's done
                         * here, in the view, not in the controller.
                         */
                        if (result.headers.find((header) => header === '_id') === undefined) {
                            tableHeaders = ['_id', ...result.headers];
                        } else {
                            tableHeaders = result.headers ?? [];
                        }

                        setCurrentQueryResults((prev) => ({
                            ...prev,
                            tableHeaders: tableHeaders,
                            tableData: (result.data as TableDataEntry[]) ?? [],
                        }));
                    })
                    .catch((_error) => {
                        console.log('error');
                    });
                break;
            }
            case Views.TREE:
                trpcClient.mongoClusters.collectionView.getCurrentPageAsTree
                    .query()
                    .then((result) => {
                        setCurrentQueryResults((prev) => ({
                            ...prev,
                            treeData: result,
                        }));
                    })
                    .catch((_error) => {
                        console.log('error');
                    });
                break;
            case Views.JSON:
                trpcClient.mongoClusters.collectionView.getCurrentPageAsJson
                    .query()
                    .then((result) => {
                        setCurrentQueryResults((prev) => ({
                            ...prev,
                            jsonDocuments: result,
                        }));
                    })
                    .catch((_error) => {
                        console.log('error');
                    });
                break;
            default:
                break;
        }
    }

    function updateAutoCompletionData(): void {
        trpcClient.mongoClusters.collectionView.getAutocompletionSchema
            .query()
            .then(async (schema) => {
                void (await currentContextRef.current.queryEditor?.setJsonSchema(schema));
            })
            .catch((_error) => {
                console.log('error');
            });
    }

    function handleDeleteDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.deleteDocumentsById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds)
            .then((acknowledged) => {
                if (!acknowledged) {
                    return;
                }

                // TODO: update cached data in the controller

                // TODO: update the current view, not all views.

                setCurrentQueryResults((prev) => ({
                    ...prev,
                    tableData: prev?.tableData?.filter(
                        (row) =>
                            !currentContextRef.current.dataSelection.selectedDocumentObjectIds.includes(
                                row['x-objectid'] ?? '',
                            ),
                    ),
                }));

                setCurrentContext((prev) => ({
                    ...prev,
                    dataSelection: {
                        selectedDocumentIndexes: [],
                        selectedDocumentObjectIds: [],
                    },
                }));
            })
            .catch((error: unknown) => {
                if (error instanceof Error) {
                    console.error('Error adding document:', error.message);
                } else {
                    console.error('Unexpected error adding document:', error);
                }
            });
    }

    function handleViewDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.viewDocumentById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds[0])
            .catch((error: unknown) => {
                if (error instanceof Error) {
                    console.error('Error opening document:', error.message);
                } else {
                    console.error('Unexpected error opening document:', error);
                }
            });
    }

    function handleEditDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.editDocumentById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds[0])
            .catch((error: unknown) => {
                if (error instanceof Error) {
                    console.error('Error opening document:', error.message);
                } else {
                    console.error('Unexpected error opening document:', error);
                }
            });
    }

    function handleAddDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.addDocument.mutate().catch((error: unknown) => {
            if (error instanceof Error) {
                console.error('Error adding document:', error.message);
            } else {
                console.error('Unexpected error adding document:', error);
            }
        });
    }

    function handleStepInRequest(row: number, cell: number): void {
        const activeDocument: TableDataEntry = currentQueryResults?.tableData?.[row] ?? {};
        const activeColumn: string = currentQueryResults?.tableHeaders?.[cell] ?? '';

        const activeCell = activeDocument[activeColumn] as { value?: string; type?: string };

        console.log('Step-in requested on cell', activeCell, 'in row', row, 'column', cell);

        // TODO: move the path from results to a better place
        setCurrentContext((prev) => ({
            ...prev,
            currentViewState: {
                currentPath: [...(currentContext.currentViewState?.currentPath ?? []), activeColumn],
            },
        }));
    }

    return (
        <CollectionViewContext.Provider value={[currentContext, setCurrentContext]}>
            <div className="collectionView">
                <div className="toolbarMainView">
                    <ToolbarMainView />
                </div>

                <QueryEditor
                    onExecuteRequest={(q: string) =>
                        setCurrentContext((prev) => ({
                            ...prev,
                            currrentQueryDefinition: { ...prev.currrentQueryDefinition, queryText: q, pageNumber: 1 },
                        }))
                    }
                />

                <TabList selectedValue="tab_result" style={{ marginTop: '-10px' }}>
                    <Tab id="tab.results" value="tab_result">
                        Results
                    </Tab>
                    <Tab id="tab.performance" value="tab_performance" disabled={true}>
                        Query Performance
                    </Tab>
                </TabList>

                <div className="resultsActionBar">
                    <ToolbarViewNavigation />
                    <ToolbarDocumentManipulation
                        onDeleteClick={handleDeleteDocumentRequest}
                        onEditClick={handleEditDocumentRequest}
                        onViewClick={handleViewDocumentRequest}
                        onAddClick={handleAddDocumentRequest}
                    />
                    <ViewSwitcher onViewChanged={handleViewChanged} />
                </div>

                <div className="resultsDisplayArea" id="resultsDisplayAreaId">
                    {
                        {
                            'Table View': (
                                <DataViewPanelTableV2
                                    liveHeaders={currentQueryResults?.tableHeaders ?? []}
                                    liveData={currentQueryResults?.tableData ?? []}
                                    handleStepIn={handleStepInRequest}
                                />
                            ),
                            'Tree View': <DataViewPanelTree liveData={currentQueryResults?.treeData ?? []} />,
                            'JSON View': <DataViewPanelJSON value={currentQueryResults?.jsonDocuments ?? []} />,
                            default: <div>error '{currentContext.currentView}'</div>,
                        }[currentContext.currentView] // switch-statement
                    }
                </div>
            </div>
        </CollectionViewContext.Provider>
    );
};
