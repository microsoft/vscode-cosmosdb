/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { useContext, useEffect, useRef, useState, type JSX } from 'react';
import './collectionView.scss';

import { Button, Dropdown, Input, Option, Toolbar, ToolbarButton } from '@fluentui/react-components';
import {
    DocumentAddRegular,
    DocumentArrowDownRegular,
    DocumentDismissRegular,
    DocumentEditRegular,
    PlayRegular,
    SearchFilled,
} from '@fluentui/react-icons';
import { type WebviewApi } from 'vscode-webview';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';
import {
    CollectionViewContext,
    DefaultCollectionViewContext,
    Views,
    type CollectionViewContextType,
} from './collectionViewContext';
import { DataViewPanelJSON } from './components/DataViewPanelJSON';
import { DataViewPanelTableV2 } from './components/DataViewPanelTableV2';
import { DataViewPanelTree } from './components/DataViewPanelTree';
import { ToolbarPaging } from './components/ToolbarPaging';

const defaultView: string = 'Table View';

export const FindQueryComponent = ({ onQueryUpdate }): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    const inputField = useRef<HTMLInputElement>(null);

    function runQuery() {
        const queryText = inputField.current?.value ?? '{}';
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        onQueryUpdate(queryText);
    }

    return (
        <div className="findQueryComponent">
            <Input
                readOnly={currentContext.isLoading}
                ref={inputField}
                contentBefore={<SearchFilled />}
                style={{ flexGrow: 1 }}
                defaultValue="{  }"
                onKeyUp={(e) => {
                    if (e.key === 'Enter') {
                        runQuery();
                    }
                }}
            />
            <Button
                onClick={runQuery}
                disabled={currentContext.isLoading}
                icon={<PlayRegular />}
                appearance="primary"
                style={{ flexShrink: 0 }}
            >
                Find Query
            </Button>
        </div>
    );
};

interface ToolbarDocumentsProps {
    onDeleteClick: () => void;
    onEditClick: () => void;
    onViewClick: () => void;
    onAddClick: () => void;
}

export const ToolbarDocuments = ({
    onDeleteClick,
    onEditClick,
    onViewClick,
    onAddClick,
}: ToolbarDocumentsProps): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    return (
        <Toolbar aria-label="with Popover" size="small">
            <ToolbarButton
                aria-label="Add new document"
                icon={<DocumentAddRegular />}
                disabled={currentContext.commands.disableAddDocument}
                onClick={onAddClick}
            />

            <ToolbarButton
                aria-label="View selected document"
                icon={<DocumentArrowDownRegular />}
                disabled={currentContext.commands.disableViewDocument}
                onClick={onViewClick}
            />

            <ToolbarButton
                aria-label="Edit selected document"
                icon={<DocumentEditRegular />}
                disabled={currentContext.commands.disableEditDocument}
                onClick={onEditClick}
            />

            <ToolbarButton
                aria-label="Delete selected document"
                icon={<DocumentDismissRegular />}
                disabled={currentContext.commands.disableDeleteDocument}
                onClick={onDeleteClick}
            />
        </Toolbar>
    );
};

function ViewSwitch({ onViewChanged }): JSX.Element {
    const [currentContext] = useContext(CollectionViewContext);

    return (
        <Dropdown
            disabled={currentContext.isLoading}
            style={{ minWidth: '120px', maxWidth: '120px' }}
            defaultValue={defaultView}
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
            onOptionSelect={(_, data) => onViewChanged(data.optionValue)}
        >
            <Option key="table">Table View</Option>
            <Option key="tree">Tree View</Option>
            <Option key="json">JSON View</Option>
        </Dropdown>
    );
}

declare global {
    interface Window {
        config?: {
            __id?: string;
            __initialData?: string;
            __liveConnectionId?: string;
            __mode?: string;
            __databaseName: string;
            __collectionName: string;
            __documentId: string;
            __documentContent: string;
            __vsCodeApi: WebviewApi<unknown>;
            [key: string]: unknown; // Optional: Allows any other properties in config
        };
    }
}

interface QueryResults {
    tableHeaders?: string[];
    tableData?: { 'x-objectid': string; [key: string]: unknown }[]; // 'x-objectid': string;

    treeData?: { [key: string]: unknown }[];

    jsonDocuments?: string[];
}

export const CollectionView = (): JSX.Element => {
    //const configuration = useConfiguration<CollectionViewWebviewConfigurationType>();
    const { clientTrpc } = useTrpcClient();

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

        clientTrpc.mongoClusters.collectionView.runQuery
            .query({
                findQuery: currentContext.currrentQueryDefinition.queryText,
                pageNumber: currentContext.currrentQueryDefinition.pageNumber,
                pageSize: currentContext.currrentQueryDefinition.pageSize,
            })
            .then((response) => {
                setCurrentContext((prev) => ({ ...prev, isLoading: false }));
                setCurrentQueryResults({
                    jsonDocuments: response.jsonDocuments ?? [],
                    tableHeaders: response.tableHeaders ?? [],
                    tableData: response.tableData ?? [],
                    treeData: response.treeData ?? [],
                });
            })
            .catch((_error) => {
                setCurrentContext((prev) => ({ ...prev, isLoading: false }));
            });
    }, [currentContext.currrentQueryDefinition]);

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
    };

    function handleDeleteRequest(): void {
        clientTrpc.mongoClusters.collectionView.deleteDocumentsById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds)
            .then((acknowledged) => {
                if (!acknowledged) {
                    return;
                }

                setCurrentQueryResults((prev) => ({
                    ...prev,
                    tableData: prev?.tableData?.filter(
                        (row) =>
                            !currentContextRef.current.dataSelection.selectedDocumentObjectIds.includes(
                                row['x-objectid'],
                            ),
                    ),
                    // TODO: update Tree data, update JSON data!
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

    function handleViewRequest(): void {
        clientTrpc.mongoClusters.collectionView.viewDocumentById
            .mutate(currentContext.dataSelection.selectedDocumentObjectIds[0])
            .catch((error: unknown) => {
                if (error instanceof Error) {
                    console.error('Error opening document:', error.message);
                } else {
                    console.error('Unexpected error opening document:', error);
                }
            });
    }

    function handleAddRequest(): void {
        clientTrpc.mongoClusters.collectionView.addDocument.mutate().catch((error: unknown) => {
            if (error instanceof Error) {
                console.error('Error adding document:', error.message);
            } else {
                console.error('Unexpected error adding document:', error);
            }
        });
    }

    return (
        <CollectionViewContext.Provider value={[currentContext, setCurrentContext]}>
            <div className="collectionView">
                <div className="queryControlArea">
                    <FindQueryComponent
                        onQueryUpdate={(q: string) =>
                            setCurrentContext((prev) => ({
                                ...prev,
                                currrentQueryDefinition: { ...prev.currrentQueryDefinition, queryText: q },
                            }))
                        }
                    />

                    <div className="actionBar">
                        <ToolbarPaging />
                        <ToolbarDocuments
                            onDeleteClick={handleDeleteRequest}
                            onEditClick={() => console.log('Edit clicked')}
                            onViewClick={handleViewRequest}
                            onAddClick={handleAddRequest}
                        />
                        <ViewSwitch onViewChanged={handleViewChanged} />
                    </div>
                </div>

                <div className="resultsDisplayArea" id="resultsDisplayAreaId">
                    {
                        {
                            'Table View': (
                                <DataViewPanelTableV2
                                    liveHeaders={currentQueryResults?.tableHeaders ?? []}
                                    liveData={currentQueryResults?.tableData ?? []}
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
