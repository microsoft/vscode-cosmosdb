/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import debounce from 'lodash.debounce';
import { useEffect, useState } from 'react';
import { SlickgridReact, type GridOption, type OnSelectedRowsChangedEventArgs } from 'slickgrid-react';
import { type TableData } from '../../utils';
import { useQueryEditorDispatcher, useQueryEditorState } from '../state/QueryEditorContext';

type ResultTabViewTableProps = TableData & {};

type GridColumn = { id: string; name: string; field: string; minWidth: number };

export const ResultTabViewTable = ({ headers, dataset }: ResultTabViewTableProps) => {
    const state = useQueryEditorState();
    const dispatcher = useQueryEditorDispatcher();

    const [reservedHeaders, setReservedHeaders] = useState<string[]>([]);

    useEffect(() => {
        setReservedHeaders(headers);
    }, [headers]);

    // If query is executing and headers are not available, use reserved headers (previous)
    // It is fix for the message "No data to display" since without data grid folds by width
    if ((!headers || headers.length === 0) && reservedHeaders.length !== 0 && state.isExecuting) {
        headers = reservedHeaders;
    }

    const gridColumns: GridColumn[] = headers.map((header) => {
        return {
            id: header + '_id',
            name: header,
            field: header.startsWith('/') ? header.slice(1) : header,
            minWidth: 100,
        };
    });

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
            gridOptions={gridOptions}
            columnDefinitions={gridColumns}
            dataset={dataset}
            onSelectedRowsChanged={(event: CustomEvent<{ args: OnSelectedRowsChangedEventArgs }>) =>
                onSelectedRowsChanged(event.detail.args)
            }
        />
    );
};
