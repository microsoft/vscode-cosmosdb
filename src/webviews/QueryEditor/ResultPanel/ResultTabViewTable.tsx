/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import debounce from 'lodash.debounce';
import * as React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    SlickgridReact,
    type Formatter,
    type GridOption,
    type OnDblClickEventArgs,
    type OnSelectedRowsChangedEventArgs,
} from 'slickgrid-react';
import { isSelectStar, type TableData } from '../../utils';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

type ResultTabViewTableProps = TableData & {};

type GridColumn = { id: string; name: string; field: string; minWidth: number; formatter: Formatter };

export const ResultTabViewTable = ({ headers, dataset, deletedRows }: ResultTabViewTableProps) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();
    const gridRef = useRef<SlickgridReact>(null);

    const isEditMode = useMemo<boolean>(
        () => isSelectStar(state.currentQueryResult?.query ?? ''),
        [state.currentQueryResult],
    );

    const [reservedHeaders, setReservedHeaders] = useState<string[]>([]);
    const [gridColumns, setGridColumns] = useState<GridColumn[]>([]);

    useEffect(() => {
        setReservedHeaders(headers);
    }, [headers]);

    // If query is executing and headers are not available, use reserved headers (previous)
    // It is fix for the message "No data to display" since without data grid folds by width
    if ((!headers || headers.length === 0) && reservedHeaders.length !== 0 && state.isExecuting) {
        headers = reservedHeaders;
    }

    useEffect(() => {
        const gridColumns: GridColumn[] = headers.map((header) => {
            return {
                id: header + '_id',
                name: header,
                field: header.startsWith('/') ? header.slice(1) : header,
                minWidth: 100,
                formatter: (row: number, _cell: number, value: string) => {
                    if (deletedRows.includes(row)) {
                        return {
                            text: value,
                            addClasses: 'row-is-deleted',
                            toolTip: 'This document is deleted',
                        };
                    } else {
                        return {
                            text: value,
                        };
                    }
                },
            };
        });

        setGridColumns(gridColumns);
    }, [headers, deletedRows]);

    React.useEffect(() => {
        gridRef.current?.gridService.renderGrid();
    }, [dataset, headers]); // Re-run when headers or data change

    const onDblClick = (args: OnDblClickEventArgs) => {
        // If not in edit mode, do nothing
        if (!isEditMode) return;

        // Open document in view mode
        const activeDocument = dataset[args.row];
        if (activeDocument && !deletedRows.includes(args.row)) {
            void dispatcher.openDocument(state.currentExecutionId, 'view', args.row);
        }
    };

    // SlickGrid emits the event twice. First time for selecting 1 row, second time for selecting this row + all rows what were selected before.
    const onSelectedRowsChanged = debounce((args: OnSelectedRowsChangedEventArgs) => {
        dispatcher.setSelectedRows(args.rows);
    }, 100);

    const gridOptions: GridOption = {
        autoResize: {
            calculateAvailableSizeBy: 'container',
            container: '.resultsDisplayArea', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
            delay: 100,
        },
        enableAutoResize: true,
        autoFitColumnsOnFirstLoad: true, // This
        enableAutoSizeColumns: true, // + this
        // disabling features that with them the grid has side effects (columns resize incorrectly after second render)
        autosizeColumnsByCellContentOnFirstLoad: false, // or this (but not both)
        enableAutoResizeColumnsByCellContent: false, // + this
        enableCellNavigation: true,
        enableCheckboxSelector: false,
        enableRowSelection: true,
        multiSelect: true,
        // disabling features that would require more polishing to make them production-ready
        enableColumnPicker: false,
        enableColumnReorder: false,
        enableContextMenu: false,
        enableGridMenu: false,
        enableHeaderButton: false,
        enableHeaderMenu: false,
        datasetIdPropertyName: '__id',
        cellValueCouldBeUndefined: true,
    };

    return (
        <SlickgridReact
            gridId="myGrid"
            ref={gridRef} // Attach the reference to SlickGrid
            gridOptions={gridOptions}
            columnDefinitions={gridColumns}
            dataset={dataset}
            onDblClick={(event) => onDblClick(event.detail.args)}
            onSelectedRowsChanged={(event: CustomEvent<{ args: OnSelectedRowsChangedEventArgs }>) =>
                onSelectedRowsChanged(event.detail.args)
            }
        />
    );
};
