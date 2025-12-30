/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import { debounce } from 'es-toolkit';
import * as React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
    SlickgridReact,
    type Column,
    type GridOption,
    type OnDblClickEventArgs,
    type OnSelectedRowsChangedEventArgs,
} from 'slickgrid-react';
import { type TableData } from '../../../utils';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';
import { useColumnMenu } from './ColumnMenu';

type ResultTabViewTableProps = TableData & {};

export const ResultTabViewTable = ({ headers, dataset }: ResultTabViewTableProps) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const gridRef = useRef<SlickgridReact>(null);
    const [announcement, setAnnouncement] = useState('');

    const { handleHeaderButtonClick, MenuElement } = useColumnMenu(gridRef);

    React.useEffect(() => {
        gridRef.current?.gridService.renderGrid();
    }, [dataset, headers]); // Re-run when headers or data change

    const gridColumns = useMemo(
        () =>
            headers.map((header) => {
                return {
                    id: header + '_id',
                    name: header,
                    field: header.startsWith('/') ? header.slice(1) : header,
                    minWidth: 100,
                    rerenderOnResize: true,
                    header: {
                        buttons: [
                            {
                                cssClass: 'slick-header-menu-button',
                                command: 'show-column-menu',
                                action: handleHeaderButtonClick,
                            },
                        ],
                    },
                    formatter: (_row, _cell, value) => {
                        if (value === undefined || value === null || value === '{}') {
                            const displayValue = value === undefined ? 'undefined' : value === null ? 'null' : '{}';
                            return `<span style="color: var(--vscode-disabledForeground); font-style: italic;">${displayValue}</span>`;
                        }
                        return String(value);
                    },
                } as Column;
            }),
        [handleHeaderButtonClick, headers],
    );

    React.useEffect(() => {
        gridRef.current?.gridService.renderGrid();

        setTimeout(() => {
            const grid = gridRef.current?.grid;
            if (!grid) return;

            // Set grid role
            const gridElement = grid.getContainerNode();
            gridElement?.setAttribute('role', 'grid');
            gridElement?.setAttribute('aria-label', 'Query results data grid');

            // Announce cell values on navigation using ARIA live region
            grid.onActiveCellChanged.subscribe((_e, args) => {
                const column = gridColumns[args.cell];
                const data = dataset[args.row];
                if (column && data) {
                    const value = data[column.field] || '';
                    // Safely extract column name - only use if it's a string
                    const columnName = typeof column.name === 'string' ? column.name : l10n.t('Column');
                    const announcementText = `${columnName}: ${value}`;
                    setAnnouncement(announcementText);
                }
            });
        }, 100);
    }, [dataset, headers, gridColumns]);

    const onDblClick = useCallback(
        (args: OnDblClickEventArgs) => {
            // If not in edit mode, do nothing
            if (!state.isEditMode) return;

            // Open document in view mode
            const activeDocument = dataset[args.row];
            const documentId = activeDocument?.__documentId;
            if (documentId) {
                void dispatcher.openDocument('view', documentId);
            }
        },
        [dataset, dispatcher, state.isEditMode],
    );

    // SlickGrid emits the event twice. First time for selecting 1 row, second time for selecting this row + all rows what were selected before.
    const onSelectedRowsChanged = useMemo(
        () =>
            debounce((args: OnSelectedRowsChangedEventArgs) => {
                globalThis.getSelection()?.removeAllRanges(); // Clear the selection in the browser to avoid confusion with SlickGrid selection
                dispatcher.setSelectedRows(args.rows);
            }, 100),
        [dispatcher],
    );

    const gridOptions = useMemo(
        (): GridOption => ({
            autoResize: {
                calculateAvailableSizeBy: 'container',
                container: '.resultsDisplayArea', // this is a selector of the parent container
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
            enableCellNavigation: true,
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
            datasetIdPropertyName: '__id',
            cellValueCouldBeUndefined: true,
        }),
        [],
    );

    return (
        <>
            {/* ARIA live region for announcements */}
            <div
                aria-live="polite"
                aria-atomic="true"
                style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px', overflow: 'hidden' }}
            >
                {announcement}
            </div>
            <SlickgridReact
                gridId="myGrid"
                ref={gridRef} // Attach the reference to SlickGrid
                options={gridOptions}
                columns={gridColumns}
                dataset={dataset}
                onDblClick={(event) => onDblClick(event.detail.args)}
                onSelectedRowsChanged={(event: CustomEvent<{ args: OnSelectedRowsChangedEventArgs }>) =>
                    onSelectedRowsChanged(event.detail.args)
                }
            />
            {MenuElement}
        </>
    );
};
