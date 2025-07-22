/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef } from 'react';
import { FieldType, Formatters, SlickgridReact, type GridOption } from 'slickgrid-react';
import { l10n } from 'vscode';

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

    const columnsDef = useMemo(
        () => [
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
        ],
        [],
    );

    const gridOptions = useMemo(
        (): GridOption => ({
            autoResize: {
                calculateAvailableSizeBy: 'container',
                container: '.resultsDisplayArea', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
                delay: 100,
            },
            enableAutoResize: true,
            enableAutoSizeColumns: true, // true as when using a tree, there are only 3 columns to work with
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
            // disabling features that would require more polishing to make them production-ready
            enableColumnPicker: false,
            enableColumnReorder: false,
            enableContextMenu: false,
            enableGridMenu: false,
            enableHeaderButton: false,
            enableHeaderMenu: false,
        }),
        [],
    );

    useEffect(() => {
        const grid = gridRef.current?.grid;
        if (!grid) return;

        // Set ARIA attributes for the grid
        const gridElement = grid.getContainerNode();
        gridElement?.setAttribute('role', 'treegrid');
        gridElement?.setAttribute('aria-label', l10n.t('Document tree view'));

        // Create a live region for announcements
        let announcer = document.getElementById('tree-announcer');
        if (!announcer) {
            announcer = document.createElement('div');
            announcer.id = 'tree-announcer';
            announcer.setAttribute('role', 'status');
            announcer.setAttribute('aria-live', 'polite');
            announcer.setAttribute('aria-atomic', 'true');
            announcer.style.position = 'absolute';
            announcer.style.left = '-10000px';
            announcer.style.width = '1px';
            announcer.style.height = '1px';
            announcer.style.overflow = 'hidden';
            document.body.appendChild(announcer);
        }

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
            let announcement = l10n.t('{0}: {1}, tree level {2}', columnName, value, level);
            if (hasChildren) {
                const isExpanded = hasChildren ? (item?.__collapsed ? l10n.t('collapsed') : l10n.t('expanded')) : '';
                announcement += `, ${isExpanded}`;
            }

            // Announce the content
            const announcerElement = document.getElementById('tree-announcer');
            if (announcerElement) {
                announcerElement.textContent = announcement;
            }
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
            const announcerElement = document.getElementById('tree-announcer');
            if (announcerElement) {
                announcerElement.textContent =
                    l10n.t('{0}: {1}, tree level {2}', columnName, value, level) + `, ${state}`;
            }

            e.preventDefault();
            e.stopPropagation();
        };

        gridElement?.addEventListener('keydown', handleKeyDown);

        // Clean up on unmount
        return () => {
            grid.onActiveCellChanged.unsubscribe(handleActiveCellChanged);
            const announcerElement = document.getElementById('tree-announcer');
            if (announcerElement) {
                document.body.removeChild(announcerElement);
            }
        };
    }, [data, columnsDef]);

    return (
        <SlickgridReact
            ref={gridRef}
            gridId="myGridTree"
            gridOptions={gridOptions}
            columnDefinitions={columnsDef}
            dataset={data}
        />
    );
};
