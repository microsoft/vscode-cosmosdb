// eslint-disable-next-line import/no-internal-modules
import { useContext, useEffect, useRef, useState, type JSX } from 'react';
import './collectionView.scss';

import { Button, Divider, Dropdown, Input, Option, Toolbar, ToolbarButton } from '@fluentui/react-components';
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
import { DataViewPanelTable } from './components/DataViewPanelTable';
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
                style={{ flexShrink: 0 }}>
                Find Query
            </Button>
        </div>
    );
};

export const ToolbarDocuments = (): JSX.Element => {
    return (
        <Toolbar aria-label="with Popover" size="small">
            <ToolbarButton aria-label="Add new document" icon={<DocumentAddRegular />} />

            <ToolbarButton aria-label="View selected document" icon={<DocumentArrowDownRegular />} />

            <ToolbarButton aria-label="Edit selected document" icon={<DocumentEditRegular />} />

            <ToolbarButton aria-label="Delete selected document" icon={<DocumentDismissRegular />} />
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
            onOptionSelect={(_, data) => onViewChanged(data.optionValue)}>
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

    // quick/temp solution
    function handleMessage(event): void {
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
        setCurrentContext((prev) => ({ ...prev, isLoading: false }));
    }

    useEffect(() => {
        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    useEffect(() => {
        setCurrentContext((prev) => ({ ...prev, isLoading: true }));
        console.log('Query:', currentContext.queryConfig);
        window.config?.__vsCodeApi.postMessage({ type: 'queryConfig', payload: currentContext.queryConfig });
    }, [currentContext.queryConfig]);

    const [currentQueryResults, setCurrentQueryResults] = useState<QueryResults>();

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
                <Divider appearance="brand" alignContent="start" style={{ paddingTop: '16px' }}>
                    {'Database: '}
                    {(window.config?.__databaseName as string) ?? ''}
                    {', Collection: '}
                    {(window.config?.__collectionName as string) ?? ''}
                    {', Status: '}
                    {currentContext.isLoading ? 'Loading...' : 'Ready.'}
                </Divider>

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

                <Divider appearance="brand" alignContent="start">
                    Your Query Results
                </Divider>

                <div className="resultsDisplayArea" id="resultsDisplayAreaId">
                    {
                        {
                            'Table View': (
                                <DataViewPanelTable
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
