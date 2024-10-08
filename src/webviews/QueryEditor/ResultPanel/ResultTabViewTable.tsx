/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import debounce from 'lodash.debounce';
import { useEffect } from 'react';
import { SlickgridReact, type GridOption, type OnSelectedRowsChangedEventArgs } from 'slickgrid-react';
import { type TableData } from '../../utils';
import { useQueryEditorDispatcher } from '../state/QueryEditorContext';

type ResultTabViewTableProps = TableData & {};

type GridColumn = { id: string; name: string; field: string; minWidth: number };

export const ResultTabViewTable = ({ headers, dataset }: ResultTabViewTableProps) => {
    const dispatcher = useQueryEditorDispatcher();

    const gridColumns: GridColumn[] = headers.map((header) => {
        return {
            id: header + '_id',
            name: header,
            field: header,
            minWidth: 100,
        };
    });

    // SlickGrid emits the event twice. First time for selecting 1 row, second time for selecting this row + all rows what were selected before.
    const onSelectedRowsChanged = debounce((args: OnSelectedRowsChangedEventArgs) => {
        const selectedRows = args.rows;
        const documentIds: string[] = selectedRows.map((row) => dataset[row]['id']);
        dispatcher.setSelectedDocumentIds(documentIds);
    }, 100);

    useEffect(() => {
        return () => {
            // Clean selected document ids when the component is unmounted
            dispatcher.setSelectedDocumentIds([]);
        };
    }, []);

    const gridOptions: GridOption = {
        autoResize: {
            calculateAvailableSizeBy: 'container',
            container: '.resultsDisplayArea', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
            delay: 100,
        },
        enableAutoResize: true,
        enableAutoSizeColumns: true, // true by default, we disabled it under the assumption that there are a lot of columns in users' data in general

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
