import * as React from 'react';
import { useContext } from 'react';
import { SlickgridReact, type Formatter, type GridOption, type OnSelectedRowsChangedEventArgs, type SlickgridReactInstance } from 'slickgrid-react';
import { type CellValue } from '../../../../webviews-extension-shared/gridSupport';
import { LoadingAnimationTable } from './LoadingAnimationTable';

import debounce from 'lodash.debounce';
import { bsonStringToDisplayString } from '../../../utils/slickgrid/typeToDisplayString';
import { CollectionViewContext } from '../collectionViewContext';
import './dataViewPanelTableV2.scss';

interface Props {
    liveHeaders: string[];
    liveData: { 'x-objectid': string; [key: string]: unknown }[];
}

const cellFormatter: Formatter<object> = (_row: number, _cell: number, value: CellValue) => {
    if (value === undefined || value === null) {
        return {
            text: '',
            toolTip: 'This field is not set',
        }
    }
    return {
        text: value.value,
        addClasses: `typedTableCell type-${value.type}`,
        toolTip: bsonStringToDisplayString(value.type),
    };
};

export function DataViewPanelTableV2({ liveHeaders, liveData }: Props): React.JSX.Element {
    const [currentContext, setCurrentContext] =  useContext(CollectionViewContext);

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
        console.log('Selected Rows Changed');

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
                selectedDocumentObjectIds: _args.rows.map((row) => liveData[row]['x-objectid']),
            },
        }));
    }

    const gridOptions: GridOption = {
        autoResize: {
            calculateAvailableSizeBy: 'container',
            container: '.resultsDisplayArea', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
            delay: 100,
        },
        enableAutoResize: true,
        enableAutoSizeColumns: true, // true by default, we disabled it under the assumption that there are a lot of columns in users' data in general

        enableCellNavigation: true,
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
        // rowSelectionOptions: { todo: [post MVP] connected to the issue above.
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
    };

    let slickGrid: SlickgridReactInstance | null = null;


    React.useEffect(() => {
        console.log('Grid View has mounted');

        return () => {
            console.log('Grid View will unmount');
            slickGrid?.gridService.setSelectedRows([]);
        };
    }, []);


    function reactGridReady(grid: SlickgridReactInstance) {
        console.log('Grid Ready');
        slickGrid = grid;
    }

    if (currentContext.isLoading) {
        return <LoadingAnimationTable />;
    } else {
        return (
            <SlickgridReact
                gridId="myGrid"
                gridOptions={gridOptions}
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                columnDefinitions={gridColumns}
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                dataset={liveData}
                // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
                onReactGridCreated={(event) => reactGridReady(event.detail)}
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