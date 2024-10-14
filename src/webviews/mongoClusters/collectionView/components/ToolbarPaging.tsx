/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dropdown, Label, Option, Toolbar, ToolbarButton, Tooltip } from '@fluentui/react-components';
import { ArrowLeftFilled, ArrowPreviousFilled, ArrowRightFilled } from '@fluentui/react-icons';
import { useContext } from 'react';
import { CollectionViewContext } from '../collectionViewContext';
import { ToolbarDividerTransparent } from './ToolbarDividerTransparent';

export interface ToolbarPagingProps {
    onPageChange: (pageSize: number, pageNumber: number) => void;
}

export const ToolbarPaging = (): JSX.Element => {
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);

    function goToNextPage() {
        setCurrentContext({
            ...currentContext,
            currrentQueryDefinition: { ...currentContext.currrentQueryDefinition, pageNumber: currentContext.currrentQueryDefinition.pageNumber + 1 },
        });
    }

    function goToPreviousPage() {
        setCurrentContext({
            ...currentContext,
            currrentQueryDefinition: {
                ...currentContext.currrentQueryDefinition,
                pageNumber: Math.max(1, currentContext.currrentQueryDefinition.pageNumber - 1),
            },
        });
    }

    function goToFirstPage() {
        setCurrentContext({
            ...currentContext,
            currrentQueryDefinition: { ...currentContext.currrentQueryDefinition, pageNumber: 1 },
        });
    }

    function setPageSize(pageSize: number) {
        setCurrentContext({
            ...currentContext,
            currrentQueryDefinition: {
                ...currentContext.currrentQueryDefinition,
                pageSize: pageSize,
                pageNumber: 1,
            },
        });
    }

    // function refresh() {
    //     setCurrentContext({
    //         ...currentContext
    //     });
    // }

    return (
        <Toolbar aria-label="with Popover" size="small">
            {/* <Tooltip content="Reload query results" relationship="description" withArrow>
                <ToolbarButton
                    onClick={refresh}
                    aria-label="Refresh"
                    icon={<ArrowClockwiseFilled />}
                    disabled={currentContext.isLoading}
                />
            </Tooltip>

            <ToolbarDivider /> */}

            <Tooltip content="Go to first page" relationship="description" withArrow>
                <ToolbarButton
                    onClick={goToFirstPage}
                    aria-label="Go to start"
                    icon={<ArrowPreviousFilled />}
                    disabled={currentContext.isLoading}
                />
            </Tooltip>

            <Tooltip content="Go to previous page" relationship="description" withArrow>
                <ToolbarButton
                    onClick={goToPreviousPage}
                    aria-label="Go to previous page"
                    icon={<ArrowLeftFilled />}
                    disabled={currentContext.isLoading}
                />
            </Tooltip>

            <Tooltip content="Go to next page" relationship="description" withArrow>
                <ToolbarButton
                    onClick={goToNextPage}
                    aria-label="Go to next page"
                    icon={<ArrowRightFilled />}
                    disabled={currentContext.isLoading}
                />
            </Tooltip>

            <ToolbarDividerTransparent />

            <Tooltip content="Change page size" relationship="description" withArrow>
                <Dropdown
                    disabled={currentContext.isLoading}
                    onOptionSelect={(_e, data) => {
                        setPageSize(parseInt(data.optionText ?? '10'));
                    }}
                    style={{ minWidth: '100px', maxWidth: '100px' }}
                    defaultValue="10"
                    defaultSelectedOptions={['10']}
                >
                    <Option key="10">10</Option>
                    <Option key="10">50</Option>
                    <Option key="100">100</Option>
                    <Option key="500">500</Option>
                </Dropdown>
            </Tooltip>

            <ToolbarDividerTransparent />

            <Label weight="semibold" className="lblPageNumber">
                <pre>Page {currentContext.currrentQueryDefinition.pageNumber}</pre>
            </Label>
        </Toolbar>
    );
};
