import * as React from 'react';
import { useContext } from 'react';
import { SlickgridReact, type Formatter, type GridOption } from 'slickgrid-react';
import { type CellValue } from '../../../../webviews-extension-shared/gridSupport';
import { CollectionViewContext } from '../collectionViewContext';
import { LoadingAnimationTable } from './LoadingAnimationTable';

import { bsonStringToDisplayString } from '../../../utils/slickgrid/typeToDisplayString';
import './dataViewPanelTableV2.scss';

interface Props {
    liveHeaders: string[];
    liveData: object[];
}

const cellFormatter: Formatter<object> = (_row: number, _cell: number, value: CellValue) => {
    return {
        text: value.value,
        addClasses: `typedTableCell type-${value.type}`,
        toolTip: bsonStringToDisplayString(value.type)
    };
};

export function DataViewPanelTableV2({ liveHeaders, liveData }: Props): React.JSX.Element {
    const [currentContext] = useContext(CollectionViewContext);

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
                onReactGridCreated={() => console.log('Grid created')}
            />
        );
    }
}
