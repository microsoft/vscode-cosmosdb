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

export const ToolbarDocuments = (): JSX.Element => {
    const [currentContext] = useContext(CollectionViewContext);

    return (
        <Toolbar aria-label="with Popover" size="small">
            <ToolbarButton
                aria-label="Add new document"
                icon={<DocumentAddRegular />}
                disabled={currentContext.commands.disableAddDocument}
            />

            <ToolbarButton
                aria-label="View selected document"
                icon={<DocumentArrowDownRegular />}
                disabled={currentContext.commands.disableViewDocument}
            />

            <ToolbarButton
                aria-label="Edit selected document"
                icon={<DocumentEditRegular />}
                disabled={currentContext.commands.disableEditDocument}
            />

            <ToolbarButton
                aria-label="Delete selected document"
                icon={<DocumentDismissRegular />}
                disabled={currentContext.commands.disableDeleteDocument}
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
            __liveConnectionId?: string;
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
    tableData?: { [key: string]: undefined }[];

    treeData?: { [key: string]: undefined }[];

    json?: string;
}

export const CollectionView = (): JSX.Element => {
    const [currentContext, setCurrentContext] = useState<CollectionViewContextType>(DefaultCollectionViewContext);
    const [currentQueryResults, setCurrentQueryResults] = useState<QueryResults>();

    // quick/temp solution
    function handleMessage(event): void {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (event.data?.type !== 'queryResults') {
            return;
        }

        setCurrentContext((prev) => ({ ...prev, isLoading: false }));
        setCurrentQueryResults((prev) => ({
            ...prev,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            tableHeaders: event.data?.tableHeaders,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            tableData: event.data?.tableData,

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            treeData: event.data?.treeData,

            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            json: event.data?.json,
        }));
    }

    useEffect(() => {
        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    //todo: remove, debugging only
    useEffect(() => {
        console.log('Selected rows / ObjectIds:', currentContext.dataSelection.selectedDocumentObjectIds);
    }, [currentContext.dataSelection.selectedDocumentObjectIds]);

    useEffect(() => {
        setCurrentContext((prev) => ({ ...prev, isLoading: true }));
        console.log('Query:', currentContext.queryConfig);
        window.config?.__vsCodeApi.postMessage({ type: 'queryConfig', payload: currentContext.queryConfig });
    }, [currentContext.queryConfig]);

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

    return (
        <CollectionViewContext.Provider value={[currentContext, setCurrentContext]}>
            <div className="collectionView">
                <div className="queryControlArea">
                    <FindQueryComponent
                        onQueryUpdate={(q: string) =>
                            setCurrentContext((prev) => ({
                                ...prev,
                                queryConfig: { ...prev.queryConfig, queryText: q },
                            }))
                        }
                    />

                    <div className="actionBar">
                        <ToolbarPaging />
                        <ToolbarDocuments />
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
                            'JSON View': <DataViewPanelJSON value={currentQueryResults?.json ?? ''} />,
                            default: <div>error '{currentContext.currentView}'</div>,
                        }[currentContext.currentView] // switch-statement
                    }
                </div>
            </div>
        </CollectionViewContext.Provider>
    );
};
