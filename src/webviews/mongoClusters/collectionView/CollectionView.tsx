/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { ProgressBar, Tab, TabList } from '@fluentui/react-components';
import { type JSX, useEffect, useRef, useState } from 'react';
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
import { ToolbarTableNavigation } from './components/toolbar/ToolbarTableNavigation';
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

    // keep Refs updated with the current state
    const currentQueryResultsRef = useRef(currentQueryResults);
    const currentContextRef = useRef(currentContext);

    useEffect(() => {
        currentQueryResultsRef.current = currentQueryResults;
        currentContextRef.current = currentContext;
    }, [currentQueryResults, currentContext]);

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

                setCurrentContext((prev) => ({ ...prev, isLoading: false, isFirstTimeLoad: false }));
            })
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: 'Error while running the query',
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            })
            .finally(() => {
                setCurrentContext((prev) => ({ ...prev, isLoading: false, isFirstTimeLoad: false }));
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

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'viewChanged',
                properties: {
                    view: selection,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });

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
                    .catch((error) => {
                        void trpcClient.common.displayErrorMessage.mutate({
                            message: 'Error while loading the data',
                            modal: false,
                            cause: error instanceof Error ? error.message : String(error),
                        });
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
                    .catch((error) => {
                        void trpcClient.common.displayErrorMessage.mutate({
                            message: 'Error while loading the data',
                            modal: false,
                            cause: error instanceof Error ? error.message : String(error),
                        });
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
                    .catch((error) => {
                        void trpcClient.common.displayErrorMessage.mutate({
                            message: 'Error while loading the data',
                            modal: false,
                            cause: error instanceof Error ? error.message : String(error),
                        });
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
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: 'Error while loading the autocompletion data',
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    }

    function handleDeleteDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.deleteDocumentsById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds)
            .then((acknowledged) => {
                if (!acknowledged) {
                    return;
                }

                /**
                 * The data on the server has been deleted and our extension code has updated its
                 * cache as well. Now we need to update the view locally, so that the user sees
                 * the changes immediately without potential focus/table resizing issues etc.
                 */

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
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: 'Error deleting selected documents',
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    }

    function handleViewDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.viewDocumentById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds[0])
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: 'Error opening the document view',
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    }

    function handleEditDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.editDocumentById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds[0])
            .catch((error) => {
                void trpcClient.common.displayErrorMessage.mutate({
                    message: 'Error opening the document view',
                    modal: false,
                    cause: error instanceof Error ? error.message : String(error),
                });
            });
    }

    function handleAddDocumentRequest(): void {
        trpcClient.mongoClusters.collectionView.addDocument.mutate().catch((error) => {
            void trpcClient.common.displayErrorMessage.mutate({
                message: 'Error opening the document view',
                modal: false,
                cause: error instanceof Error ? error.message : String(error),
            });
        });
    }

    function handleStepInRequest(row: number, cell: number): void {
        const activeDocument: TableDataEntry = currentQueryResults?.tableData?.[row] ?? {};
        const activeColumn: string = currentQueryResults?.tableHeaders?.[cell] ?? '';

        const activeCell = activeDocument[activeColumn] as { value?: string; type?: string };

        console.debug('Step-in requested on cell', activeCell, 'in row', row, 'column', cell);

        if (activeColumn === '_id') {
            console.debug('Cell is an _id, skipping step-in');
            return;
        }

        if (activeCell.type !== 'object') {
            console.debug('Cell is not an object, skipping step-in');
            return;
        }

        const newPath = [...(currentContext.currentViewState?.currentPath ?? []), activeColumn];

        setCurrentContext((prev) => ({
            ...prev,
            currentViewState: {
                currentPath: newPath,
            },
        }));

        trpcClient.common.reportEvent
            .mutate({
                eventName: 'stepIn',
                properties: {
                    source: 'step-in-button',
                },
                measurements: {
                    depth: newPath.length ?? 0,
                },
            })
            .catch((error) => {
                console.debug('Failed to report an event:', error);
            });
    }

    return (
        <CollectionViewContext.Provider value={[currentContext, setCurrentContext]}>
            <div className="collectionView">
                {currentContext.isLoading && <ProgressBar thickness="large" shape="square" className="progressBar" />}

                <div className="toolbarMainView">
                    <ToolbarMainView />
                </div>

                <QueryEditor
                    onExecuteRequest={(q: string) => {
                        setCurrentContext((prev) => ({
                            ...prev,
                            currrentQueryDefinition: { ...prev.currrentQueryDefinition, queryText: q, pageNumber: 1 },
                        }));

                        trpcClient.common.reportEvent
                            .mutate({
                                eventName: 'executeQuery',
                                properties: {
                                    ui: 'shortcut',
                                },
                                measurements: {
                                    queryLenth: q.length,
                                },
                            })
                            .catch((error) => {
                                console.debug('Failed to report an event:', error);
                            });
                    }}
                />

                <TabList selectedValue="tab_result" style={{ marginTop: '-10px' }}>
                    <Tab id="tab.results" value="tab_result">
                        Results
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

                {currentContext.currentView === Views.TABLE && (
                    <div className="toolbarTableNavigation">
                        <ToolbarTableNavigation />
                    </div>
                )}
            </div>
        </CollectionViewContext.Provider>
    );
};
