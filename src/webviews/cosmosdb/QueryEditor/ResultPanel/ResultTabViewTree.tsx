/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FieldType, Formatters, SlickgridReact, type GridOption } from 'slickgrid-react';
import { DynamicThemeProvider } from '../../../theme/DynamicThemeProvider';
import { useColumnMenu } from './ColumnMenu';

type ResultTabViewTreeProps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>[];
};

interface TreeDataItem {
    [key: string]: unknown;
    __treeLevel?: number;
    __hasChildren?: boolean;
    __collapsed?: boolean;
    treeLevel?: number;
    hasChildren?: boolean;
    collapsed?: boolean;
}

export const ResultTabViewTree = ({ data }: ResultTabViewTreeProps) => {
    const gridRef = useRef<SlickgridReact>(null);
    const { handleHeaderButtonClick, MenuElement } = useColumnMenu(gridRef);

    const columnsDef = useMemo(
        () =>
            [
                {
                    id: 'id_field',
                    name: 'Field',
                    field: 'field',
                    minWidth: 100,
                    type: FieldType.string,
                    formatter: Formatters.tree,
                    cssClass: 'cell-title',
                    filterable: true,
                    sortable: true,
                },
                { id: 'id_value', name: 'Value', field: 'value', minWidth: 100, filterable: true },
                { id: 'id_type', name: 'Type', field: 'type', minWidth: 100, filterable: true },
                { id: 'id', name: 'id', field: 'id', hidden: true },
            ].map((col) => {
                return {
                    ...col,
                    header: {
                        buttons: [
                            {
                                cssClass: 'slick-header-menu-button',
                                command: 'show-column-menu',
                                action: handleHeaderButtonClick,
                            },
                        ],
                    },
                };
            }),
        [handleHeaderButtonClick],
    );

    const gridOptions = useMemo(
        (): GridOption => ({
            autoResize: {
                calculateAvailableSizeBy: 'container',
                container: '.resultsDisplayArea', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
                delay: 100,
                autoHeightRecalcRow: 1,
                autoHeight: true,
                bottomPadding: 20,
                resizeDetection: 'container',
                applyResizeToContainer: true,
            },
            resizeByContentOptions: {
                alwaysRecalculateColumnWidth: true,
                cellCharWidthInPx: 8.5,
                defaultRatioForStringType: 1.0,
            },
            alwaysShowVerticalScroll: false,
            autoHeight: false, // this is set to false because we want to use autoResize instead
            enableAutoResize: true,
            autoFitColumnsOnFirstLoad: false, // This
            enableAutoSizeColumns: false, // + this
            // disabling features that with them the grid has side effects (columns resize incorrectly after second render)
            autosizeColumnsByCellContentOnFirstLoad: true, // or this (but not both)
            enableAutoResizeColumnsByCellContent: true, // + this
            resizeByContentOnlyOnFirstLoad: false, // + this
            enableCheckboxSelector: false,
            enableRowSelection: true,
            multiSelect: true,
            // disabling features that would require more polishing to make them production-ready
            enableColumnPicker: false,
            enableColumnReorder: false,
            enableContextMenu: false,
            enableGridMenu: false,
            enableHeaderMenu: false, // Disable header menu by default
            enableHeaderButton: true, // Enable header buttons

            showHeaderRow: false, // this actually hides the filter-view, not the header: https://ghiscoding.gitbook.io/slickgrid-universal/grid-functionalities/tree-data-grid#parentchild-relation-dataset:~:text=If%20you%20don%27t,showHeaderRow%3A%20false
            enableFiltering: true, // required by slickgrid to render Tree Data
            enableSorting: true,
            enableTreeData: true,
            enableCellNavigation: true, // Enable cell navigation
            editable: false, // Set to false for read-only
            autoEdit: false, // Disable auto-edit
            treeDataOptions: {
                columnId: 'id_field',
                parentPropName: 'parentId',
                indentMarginLeft: 15,
                initiallyCollapsed: true,
                initialSort: {
                    columnId: 'id',
                    direction: 'ASC',
                },
                // we can also add a custom Formatter just for the title text portion
                titleFormatter: (_row, _cell, value, _def, _dataContext) => {
                    return `<span class="bold">${value}</span>`;
                },
            },
            multiColumnSort: false, // multi-column sorting is not supported with Tree Data, so you need to disable it
        }),
        [],
    );
    const [announcement, setAnnouncement] = useState('');
    useEffect(() => {
        const grid = gridRef.current?.grid;
        if (!grid) return;

        // Set ARIA attributes for the grid
        const gridElement = grid.getContainerNode();

        // Announce cell content when active cell changes
        const handleActiveCellChanged = (_e: unknown, args: { row: number; cell: number }) => {
            // Get the active cell node from SlickGrid
            const activeCellNode = grid.getCellNode(args.row, args.cell);
            let value = '';
            if (activeCellNode) {
                // For tree cells, get the text from the rendered DOM
                const treeSpan = activeCellNode.querySelector('.slick-tree-title');
                if (treeSpan) {
                    value = treeSpan.textContent || '';
                } else {
                    value = activeCellNode.textContent || '';
                }
            }

            // Get column info
            const column = grid.getColumns()[args.cell];
            const item = grid.getDataItem(args.row) as TreeDataItem;
            const level = item?.__treeLevel ?? 0;
            const hasChildren = item?.__hasChildren ?? false;

            // Build comprehensive announcement
            const columnName = typeof column?.name === 'string' ? column.name : '';
            let announcementText = l10n.t('{columnName}: {value}, tree level {level}', { columnName, value, level});
            if (hasChildren) {
                const isExpanded = hasChildren ? (item?.__collapsed ? l10n.t('collapsed') : l10n.t('expanded')) : '';
                announcementText += `, ${isExpanded}`;
            }
            // Announce the content
            setAnnouncement(announcementText);
        };

        // Subscribe to active cell changes
        grid.onActiveCellChanged.subscribe(handleActiveCellChanged);

        // Keyboard accessibility: expand/collapse with Space/Enter
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== ' ' && e.key !== 'Enter') return;

            const activeCell = grid.getActiveCell();
            if (!activeCell) return;

            const item = grid.getDataItem(activeCell.row) as TreeDataItem;
            if (!item || !item.__hasChildren) return;

            // Toggle collapsed state
            item.__collapsed = !item.__collapsed;
            grid.getData().updateItem((item as { id: string | number }).id, item); // update the item in the grid's data view
            grid.invalidateRow(activeCell.row);
            grid.render();

            // Announce the new state
            const state = item.__collapsed ? l10n.t('collapsed') : l10n.t('expanded');
            const column = grid.getColumns()[activeCell.cell];
            const fieldValue = item[column.field];
            const value = fieldValue !== null && fieldValue !== undefined ? String(fieldValue) : '';
            const level = item.__treeLevel ?? 0;
            const columnName = typeof column?.name === 'string' ? column.name : '';
            const announcementText = l10n.t('{columnName}: {value}, tree level {level}', { columnName, value, level}) + `, ${state}`;
            setAnnouncement(announcementText);
            e.preventDefault();
            e.stopPropagation();
        };

        gridElement?.addEventListener('keydown', handleKeyDown);

        // Clean up on unmount
        return () => {
            grid.onActiveCellChanged.unsubscribe(handleActiveCellChanged);
            gridElement?.removeEventListener('keydown', handleKeyDown);
        };
    }, [data, columnsDef]);

    return (
        <DynamicThemeProvider useAdaptive={true}>
            {/* ARIA live region for announcements */}
            <div
                aria-live="polite"
                aria-atomic="true"
                style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px', overflow: 'hidden' }}
            >
                {announcement}
            </div>
            <SlickgridReact
                gridId="myGridTree"
                ref={gridRef} // Attach the reference to SlickGrid
                gridOptions={gridOptions}
                columnDefinitions={columnsDef}
                dataset={data}
            />
            {MenuElement}
        </DynamicThemeProvider>
    );
};
