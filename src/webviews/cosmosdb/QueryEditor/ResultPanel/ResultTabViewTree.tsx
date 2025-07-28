/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo, useRef } from 'react';
import { FieldType, Formatters, SlickgridReact, type GridOption } from 'slickgrid-react';
import { useColumnMenu } from './ColumnMenu';

type ResultTabViewTreeProps = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    data: Record<string, any>[];
};

export const ResultTabViewTree = ({ data }: ResultTabViewTreeProps) => {
    const gridRef = useRef<SlickgridReact>(null);

    const { handleHeaderButtonClick, MenuElement } = useColumnMenu(gridRef);

    const columnsDef = useMemo(
        () =>
            [
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
            ].map((col) => {
                return {
                    ...col,
                    header: {
                        buttons: [
                            {
                                cssClass: 'slick-header-menu-button',
                                command: 'show-column-menu',
                                action: handleHeaderButtonClick,
                            },
                        ],
                    },
                };
            }),
        [handleHeaderButtonClick],
    );

    const gridOptions = useMemo(
        (): GridOption => ({
            autoResize: {
                calculateAvailableSizeBy: 'container',
                container: '.resultsDisplayArea', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
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

            showHeaderRow: false, // this actually hides the filter-view, not the header: https://ghiscoding.gitbook.io/slickgrid-universal/grid-functionalities/tree-data-grid#parentchild-relation-dataset:~:text=If%20you%20don%27t,showHeaderRow%3A%20false
            enableFiltering: true, // required by slickgrid to render Tree Data
            enableSorting: true,
            enableTreeData: true,
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
        }),
        [],
    );

    return (
        <>
            <SlickgridReact
                gridId="myGridTree"
                ref={gridRef} // Attach the reference to SlickGrid
                gridOptions={gridOptions}
                columnDefinitions={columnsDef}
                dataset={data}
            />
            {MenuElement}
        </>
    );
};
