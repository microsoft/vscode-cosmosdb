// eslint-disable-next-line import/no-internal-modules
import { useState, type JSX } from 'react';
import './collectionView.scss';

import { Button, Divider, Dropdown, Input, Label, Option, Toolbar, ToolbarButton, ToolbarDivider, Tooltip } from '@fluentui/react-components';
import { ArrowClockwiseFilled, ArrowLeftFilled, ArrowPreviousFilled, ArrowRightFilled, DocumentAddRegular, DocumentArrowDownRegular, DocumentDismissRegular, DocumentEditRegular, PlayRegular, SearchFilled } from "@fluentui/react-icons";
import { DataViewPanelJSON } from './dataViewPanelJSON';
import { DataViewPanelTable } from './dataViewPanelTable';
import { DataViewPanelTree } from './dataViewPanelTree';



export const FindQueryComponent = (): JSX.Element => {
    return (
        <div className='findQueryComponent'>
            <Input contentBefore={<SearchFilled />} style={{ flexGrow: 1 }} />
            <Button icon={<PlayRegular />} appearance="primary" style={{ flexShrink: 0 }}>Run Find Query</Button>
        </div>
    );
};


export const ToolbarDividerTransparent = (): JSX.Element => {
    return (
        <div className='toolbarDividerTransparent' />
    );
};



export const ToolbarPaging = (): JSX.Element => {
    return (
        <Toolbar aria-label="with Popover" size="small">

            <Tooltip
                content="Reload query results"
                relationship="description"
                withArrow
            >
                <ToolbarButton
                    aria-label="Refresh"
                    icon={< ArrowClockwiseFilled />}
                />
            </Tooltip>

            <ToolbarDivider />

            <Tooltip
                content="Go to first page"
                relationship="description"
                withArrow
            >
                <ToolbarButton
                    aria-label="Go to start"
                    icon={< ArrowPreviousFilled />}
                />
            </Tooltip>

            <Tooltip
                content="Go to previous page"
                relationship="description"
                withArrow
            >
                <ToolbarButton
                    aria-label="Go to previous page"
                    icon={< ArrowLeftFilled />}
                />
            </Tooltip>

            <Tooltip
                content="Go to next page"
                relationship="description"
                withArrow
            >
                <ToolbarButton
                    aria-label="Go to next page"
                    icon={< ArrowRightFilled />}
                />
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip
                content="Change page size"
                relationship="description"
                withArrow
            >
                <Dropdown
                    style={{ minWidth: '100px', maxWidth: '100px' }}
                    defaultValue="50"
                    defaultSelectedOptions={["50"]}
                >
                    <Option key="10">
                        10
                    </Option>
                    <Option key="10">
                        50
                    </Option>
                    <Option key="100">
                        100
                    </Option>
                    <Option key="500">
                        500
                    </Option>
                </Dropdown>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Label weight='semibold' className="lblPageNumber">Page 1</Label>


        </Toolbar>
    );
}



export const ToolbarDocuments = (): JSX.Element => {
    return (
        <Toolbar aria-label="with Popover" size="small">

            <ToolbarButton
                aria-label="Add new document"
                icon={< DocumentAddRegular />}
            />

            <ToolbarButton
                aria-label="View selected document"
                icon={< DocumentArrowDownRegular />}
            />

            <ToolbarButton
                aria-label="Edit selected document"
                icon={< DocumentEditRegular />}
            />

            <ToolbarButton
                aria-label="Delete selected document"
                icon={< DocumentDismissRegular />}
            />

        </Toolbar>
    );
}

const ActionBar = (props: { children: JSX.Element[] }): JSX.Element => {
    return (
        <div className='actionBar'>
            {props.children}
        </div>
    );
}



function ViewSwitch({ onViewChanged }): JSX.Element {
    return (
        <Dropdown style={{ minWidth: '120px', maxWidth: '120px' }}
            defaultValue="Tree View"
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
            onOptionSelect={(_, data) => onViewChanged(data.optionValue)}
        >
            <Option key="table">
                Table View
            </Option>
            <Option key="tree">
                Tree View
            </Option>
            <Option key="json">
                JSON View
            </Option>
        </Dropdown>

    );
}



export const CollectionView = (): JSX.Element => {
    const [currentView, setCurrentView] = useState('Tree View');

    const handleViewChanged = (optionValue: string) => {
        setCurrentView(optionValue);
    };

    return (
        <div className='webview'>
            <Divider appearance="brand" alignContent='start'>Your Query</Divider>

            <div className='queryControlArea'>
                <FindQueryComponent />
                <ActionBar>
                    <ToolbarPaging />
                    <ToolbarDocuments />
                    <ViewSwitch onViewChanged={handleViewChanged} />
                </ActionBar>
            </div >

            <Divider appearance="brand" alignContent='start'>Your Query Results</Divider>

            {currentView === 'Table View' ? <DataViewPanelTable /> : ''}
            {currentView === 'Tree View' ? <DataViewPanelTree /> : ''}
            {currentView === 'JSON View' ? <DataViewPanelJSON /> : ''}


        </div >


    );
};
