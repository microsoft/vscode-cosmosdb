/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { FieldType, Formatters, SlickgridReact, type GridOption } from 'slickgrid-react';

interface Props {
    liveData: { [key: string]: unknown }[];
}

export const DataViewPanelTree = ({ liveData }: Props): React.JSX.Element => {
    const columnsDef = [
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
    ];

    const gridOptions: GridOption = {
        autoResize: {
            calculateAvailableSizeBy: 'container',
            container: '.resultsDisplayArea', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
            delay: 100,
            bottomPadding: 0,
        },
        enableAutoResize: true,
        enableAutoSizeColumns: true, // true as when using a tree, there are only 3 columns to work with

        showHeaderRow: false, // this actually hides the filter-view, not the header: https://ghiscoding.gitbook.io/slickgrid-universal/grid-functionalities/tree-data-grid#parentchild-relation-dataset:~:text=If%20you%20don%27t,showHeaderRow%3A%20false

        enableFiltering: true, // required by slickgrid to render Tree Data
        enableSorting: false,

        enableTreeData: true,

        treeDataOptions: {
            columnId: 'id_field',
            parentPropName: 'parentId',
            // this is optional, you can define the tree level property name that will be used for the sorting/indentation, internally it will use "__treeLevel"
            levelPropName: 'treeLevel',
            indentMarginLeft: 15,
            initiallyCollapsed: true,

            // initialSort: {
            //     // tn: incredible! this is actually needed if you want to shown chevrons to expand/collapse the tree (!??? 2h+ to find this by trial&error)
            //     // https://github.com/ghiscoding/slickgrid-react/discussions/393
            //     // with the 5.5.1 release of slickgrid-react, this is no longer needed
            //     columnId: 'id_field',
            //     direction: 'ASC',
            // },

            // we can also add a custom Formatter just for the title text portion
            titleFormatter: (_row, _cell, value, _def, _dataContext) => {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-plus-operands
                //return `<span class="bold">${value}</span> <span style="font-size:11px; margin-left: 15px;">(id: ${dataContext.id} | ${dataContext.parentId ? `parentId: ` + dataContext.parentId : `root`})</span>`;
                return `<span class="bold">${value}</span>`;
            },
        },
        multiColumnSort: false, // multi-column sorting is not supported with Tree Data, so you need to disable it
        // disalbing features that would require more polishing to make them production-ready
        enableColumnPicker: false,
        enableColumnReorder: false,
        enableContextMenu: false,
        enableGridMenu: false,
        enableHeaderButton: false,
        enableHeaderMenu: false,
    };

    // Empty dependency array means this runs only once, like componentDidMount

    return (
        <SlickgridReact
            gridId="myGridTree"
            gridOptions={gridOptions}
            columnDefinitions={columnsDef}
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            dataset={liveData}
            onReactGridCreated={() => console.log('Tree View created')}
        />
    );
};
