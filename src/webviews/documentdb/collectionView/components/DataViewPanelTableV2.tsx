/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import debounce from 'lodash.debounce';
import * as React from 'react';
import { useContext, useRef } from 'react';
import {
    SlickgridReact,
    type Formatter,
    type GridOption,
    type OnDblClickEventArgs,
    type OnSelectedRowsChangedEventArgs,
} from 'slickgrid-react';
import { type TableDataEntry } from '../../../../documentdb/ClusterSession';
import { type CellValue } from '../../../../utils/slickgrid/CellValue';
import { bsonStringToDisplayString } from '../../../utils/slickgrid/typeToDisplayString';
import { CollectionViewContext } from '../collectionViewContext';
import './dataViewPanelTableV2.scss';
import { LoadingAnimationTable } from './LoadingAnimationTable';

interface Props {
    liveHeaders: string[];
    liveData: TableDataEntry[];
    handleStepIn: (row: number, cell: number) => void;
}

const cellFormatter: Formatter<object> = (_row: number, _cell: number, value: CellValue) => {
    if (value === undefined || value === null) {
        return {
            text: '',
            toolTip: l10n.t('This field is not set'),
        };
    }
    return {
        text: value.value,
        addClasses: `typedTableCell type-${value.type}`,
        toolTip: bsonStringToDisplayString(value.type),
    };
};

export function DataViewPanelTableV2({ liveHeaders, liveData, handleStepIn }: Props): React.JSX.Element {
    const [currentContext, setCurrentContext] = useContext(CollectionViewContext);

    const gridRef = useRef<SlickgridReact>(null);

    type GridColumn = { id: string; name: string; field: string; minWidth: number };

    const gridColumns: GridColumn[] = liveHeaders.map((header) => {
        return {
            id: header + '_id',
            name: header,
            field: header,
            minWidth: 100,
            formatter: cellFormatter,
        };
    });

    function onSelectedRowsChanged(_eventData: unknown, _args: OnSelectedRowsChangedEventArgs) {
        setCurrentContext((prev) => ({
            ...prev,
            commands: {
                ...currentContext.commands,
                disableAddDocument: false,
                disableDeleteDocument: _args.rows.length === 0,
                disableEditDocument: _args.rows.length !== 1,
                disableViewDocument: _args.rows.length !== 1,
            },
            dataSelection: {
                selectedDocumentIndexes: _args.rows,
                selectedDocumentObjectIds: _args.rows.map((row) => liveData[row]['x-objectid'] ?? ''),
            },
        }));
    }

    function onCellDblClick(event: CustomEvent<{ eventData: unknown; args: OnDblClickEventArgs }>) {
        const activeDocument = liveData[event.detail.args.row];
        const activeColumn = gridColumns[event.detail.args.cell].field;

        const activeCell = activeDocument[activeColumn] as { type?: string };

        if (activeCell && activeCell.type === 'object') {
            handleStepIn(event.detail.args.row, event.detail.args.cell);
        }
    }

    const gridOptions: GridOption = {
        autoResize: {
            calculateAvailableSizeBy: 'container',
            container: '#resultsDisplayAreaId', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
            delay: 100,
            bottomPadding: 2,
        },
        enableAutoResize: true,
        enableAutoSizeColumns: true, // true by default, we disabled it under the assumption that there are a lot of columns in users' data in general

        enableCellNavigation: true,
        enableTextSelectionOnCells: true,

        enableCheckboxSelector: false, // todo: [post MVP] this is failing, it looks like it happens when we're defining columns after the grid has been created.. we're deleting the 'checkbox' column. we  can work around it, but it needs a bit more attention to get it done right.
        enableRowSelection: true,
        multiSelect: true,
        // checkboxSelector: {
        //     // optionally change the column index position of the icon (defaults to 0)
        //     // columnIndexPosition: 1,

        //     // you can toggle these 2 properties to show the "select all" checkbox in different location
        //     hideInFilterHeaderRow: false,
        //     hideInColumnTitleRow: true,
        //     applySelectOnAllPages: true, // when clicking "Select All", should we apply it to all pages (defaults to true)
        // },
        // rowSelectionOptions: {
        //     // todo: [post MVP] connected to the issue above.
        //     // True (Single Selection), False (Multiple Selections)
        //     selectActiveRow: false,
        // },

        // disalbing features that would require more polishing to make them production-ready
        enableColumnPicker: false,
        enableColumnReorder: false,
        enableContextMenu: false,
        enableGridMenu: false,
        enableHeaderButton: false,
        enableHeaderMenu: false,
        footerRowHeight: 1,
    };

    React.useEffect(() => {
        return () => {
            gridRef.current?.gridService.setSelectedRows([]);
        };
    }, []);

    /*
     * Effect to manually trigger grid update on liveHeaders or liveData change.
     * This is necessary because SlickGrid does not consistently re-render when data changes.
     * This could be an implementation issue/details of the SlickGrid React wrapper
     * or a mistake in the way we're using the grid.
     */
    React.useEffect(() => {
        gridRef.current?.gridService.renderGrid();
    }, [liveData, gridColumns]); // Re-run when headers or data change

    if (currentContext.isFirstTimeLoad) {
        return <LoadingAnimationTable />;
    } else {
        return (
            <SlickgridReact
                gridId="myGrid"
                ref={gridRef} // Attach the reference to SlickGrid
                gridOptions={gridOptions}
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                columnDefinitions={gridColumns}
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                dataset={liveData}
                onDblClick={(event) => onCellDblClick(event)}
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                // debouncing here as multiple events are fired on multiselect
                onSelectedRowsChanged={debounce(
                    (event: { detail: { eventData: unknown; args: OnSelectedRowsChangedEventArgs } }) =>
                        onSelectedRowsChanged(event.detail.eventData, event.detail.args),
                    100,
                )}
            />
        );
    }
}
