/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect } from 'react';
import { FieldType, Formatters, SlickgridReact, type GridOption } from 'slickgrid-react';

type ResultTabViewTreeProps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>[];
};

export const ResultTabViewTree = ({ data }: ResultTabViewTreeProps) => {
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
    };

    useEffect(() => {
        return () => {
            /**
             * The following code is required to undo modifications made to the data
             * by the SlickGrid Tree Data plugin. If you don't do this, the data
             * will start to duplicate as the 'children' property is filled with
             * new nodes on each mount. This leads to duplicates and the tree view crashing.
             *
             * This is a known issue with the SlickGrid Tree Data plugin and is being discussed here:
             * https://github.com/ghiscoding/slickgrid-universal/discussions/1655
             */
            data.forEach((item) => {
                delete item.children;
            });
        };
    }, []);

    return (
        <SlickgridReact
            gridId="myGridTree"
            gridOptions={gridOptions}
            columnDefinitions={columnsDef}
            dataset={data}
            onReactGridCreated={() => console.log('Tree View created')}
        />
    );
};
