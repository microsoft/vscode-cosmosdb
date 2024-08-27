// eslint-disable-next-line import/no-internal-modules
import { Suspense, useEffect, useState, type JSX } from 'react';
import './collectionView.scss';

import {
    Button,
    Divider,
    Dropdown,
    Input,
    Label,
    Option,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
    Tooltip,
} from '@fluentui/react-components';
import {
    ArrowClockwiseFilled,
    ArrowLeftFilled,
    ArrowPreviousFilled,
    ArrowRightFilled,
    DocumentAddRegular,
    DocumentArrowDownRegular,
    DocumentDismissRegular,
    DocumentEditRegular,
    PlayRegular,
    SearchFilled,
} from '@fluentui/react-icons';
import { type WebviewApi } from 'vscode-webview';
import { DataViewPanelJSON } from './dataViewPanelJSON';
import { DataViewPanelTable } from './dataViewPanelTable';
import { DataViewPanelTree } from './dataViewPanelTree';

const defaultView: string = 'Table View';

export const FindQueryComponent = ({ onQueryUpdate }): JSX.Element => {
    function runQuery() {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        const query = (document.querySelector('.findQueryComponent input') as HTMLInputElement).value;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        onQueryUpdate(query);
    }

    return (
        <div className="findQueryComponent">
            <Input contentBefore={<SearchFilled />} style={{ flexGrow: 1 }} value="{  }" readOnly={true} />
            <Button onClick={runQuery} icon={<PlayRegular />} appearance="primary" style={{ flexShrink: 0 }}>
                Run Find Query
            </Button>
        </div>
    );
};

export const ToolbarDividerTransparent = (): JSX.Element => {
    return <div className="toolbarDividerTransparent" />;
};

interface ToolbarPagingProps {
    onPageChange: (pageSize: number, pageNumber: number) => void;
}

export const ToolbarPaging = ({ onPageChange }: ToolbarPagingProps): JSX.Element => {
    type PagingState = {
        pageNumber: number;
        pageSize: number;
    };

    const [pageConfig, setPageConfig] = useState<PagingState>({ pageNumber: 1, pageSize: 10 });

    function nextPage() {
        setPageConfig((prev) => ({ ...prev, pageNumber: prev.pageNumber + 1 }));
    }

    function prevPage() {
        setPageConfig((prev) => ({ ...prev, pageNumber: Math.max(1, prev.pageNumber - 1) }));
    }

    function firstPage() {
        setPageConfig((prev) => ({ ...prev, pageNumber: 1 }));
    }

    useEffect(() => {
        console.log('Page:', pageConfig);
        onPageChange(pageConfig.pageSize, pageConfig.pageNumber);
    }, [pageConfig]);

    return (
        <Toolbar aria-label="with Popover" size="small">
            <Tooltip content="Reload query results" relationship="description" withArrow>
                <ToolbarButton aria-label="Refresh" icon={<ArrowClockwiseFilled />} />
            </Tooltip>

            <ToolbarDivider />

            <Tooltip content="Go to first page" relationship="description" withArrow>
                <ToolbarButton onClick={firstPage} aria-label="Go to start" icon={<ArrowPreviousFilled />} />
            </Tooltip>

            <Tooltip content="Go to previous page" relationship="description" withArrow>
                <ToolbarButton onClick={prevPage} aria-label="Go to previous page" icon={<ArrowLeftFilled />} />
            </Tooltip>

            <Tooltip content="Go to next page" relationship="description" withArrow>
                <ToolbarButton onClick={nextPage} aria-label="Go to next page" icon={<ArrowRightFilled />} />
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content="Change page size" relationship="description" withArrow>
                <Dropdown
                    onOptionSelect={(_e, data) =>
                        setPageConfig((prev) => ({ ...prev, pageSize: parseInt(data.optionText ?? '10') }))
                    }
                    style={{ minWidth: '100px', maxWidth: '100px' }}
                    defaultValue="10"
                    defaultSelectedOptions={['10']}>
                    <Option key="10">10</Option>
                    <Option key="10">50</Option>
                    <Option key="100">100</Option>
                    <Option key="500">500</Option>
                </Dropdown>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Label weight="semibold" className="lblPageNumber">
                Page {pageConfig.pageNumber}
            </Label>
        </Toolbar>
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

const ActionBar = (props: { children: JSX.Element[] }): JSX.Element => {
    return <div className="actionBar">{props.children}</div>;
};

function ViewSwitch({ onViewChanged }): JSX.Element {
    return (
        <Dropdown
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
            [key: string]: unknown; // Optional: Allows any other properties in config
            __vsCodeApi: WebviewApi<unknown>;
        };
    }
}

type TableColumnDef = { id: string; name: string; field: string; minWidth: number };

interface QueryResults {
    table?: object[];
    tableColumns?: TableColumnDef[];
    tree?: string;
    json?: string;
}

export const CollectionView = (): JSX.Element => {
    const [currentView, setCurrentView] = useState(defaultView);

    // quick/temp solution
    function handleMessage(event) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        setCurrentQueryResults((prev) => ({
            ...prev,
            json: event.data?.json,
            table: event.data?.table,
            tableColumns: event.data?.tableColumns,
            tree: event.data?.tree
        }));

        console.log('Received message:', event);
    }

    useEffect(() => {
        window.addEventListener('message', handleMessage);

        return () => {
            window.removeEventListener('message', handleMessage);
        };
    }, []);

    type QueryConfig = {
        query: string;
        pageNumber: number;
        pageSize: number;
    };

    const [queryConfig, setQueryConfig] = useState<QueryConfig>({ query: '', pageNumber: 1, pageSize: 10 });

    useEffect(() => {
        console.log('Query:', queryConfig);
        window.config?.__vsCodeApi.postMessage({ type: 'queryConfig', queryConfig });
    }, [queryConfig]);

    const [currentQueryResults, setCurrentQueryResults] = useState<QueryResults>();

    // function updateQuery(query: string) {
    //     console.log('Updating query to:', query);

    //     //window.config?.__vsCodeApi.postMessage({ type: 'query', query });

    //     // setCurrentQueryResults( prev => ({ ...prev, json: query }));
    // }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    // const idValue = window.config?.__id;
    // console.log('The value of id is:', idValue);

    const handleViewChanged = (optionValue: string) => {
        setCurrentView(optionValue);
    };

    return (
        <div className="collectionView">
            <Divider appearance="brand" alignContent="start" style={{ paddingTop: '16px' }}>
                Your Query
            </Divider>

            <div className="queryControlArea">
                <FindQueryComponent onQueryUpdate={(q: string) => setQueryConfig((prev) => ({ ...prev, query: q }))} />

                <ActionBar>
                    <ToolbarPaging
                        onPageChange={(pageS: number, pageN: number) =>
                            setQueryConfig((prev) => ({ ...prev, pageSize: pageS, pageNumber: pageN }))
                        }
                    />
                    <ToolbarDocuments />
                    <ViewSwitch onViewChanged={handleViewChanged} />
                </ActionBar>
            </div>

            <Divider appearance="brand" alignContent="start">
                Your Query Results
            </Divider>

            <div className="resultsDisplayArea" id="resultsDisplayAreaId">
                <Suspense fallback={<div>Loading...</div>}>
                    {
                        {
                            'Table View': (
                                <DataViewPanelTable
                                    liveColumns={currentQueryResults?.tableColumns}
                                    liveData={currentQueryResults?.table}
                                />
                            ),
                            'Tree View': <DataViewPanelTree liveData={currentQueryResults?.tree} />,
                            'JSON View': <DataViewPanelJSON value={currentQueryResults?.json} />,
                        }[currentView] // switch-statement
                    }
                </Suspense>
            </div>
        </div>
    );
};
