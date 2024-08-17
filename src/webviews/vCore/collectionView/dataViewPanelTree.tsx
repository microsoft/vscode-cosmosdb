import * as React from 'react';
import { FieldType, Formatters, SlickgridReact, type GridOption } from 'slickgrid-react';

export const DataViewPanelTree = (): React.JSX.Element => {
    type ColumnDef = { id: string; name: string; field: string; minWidth: number };
    type Data = { id: number; parentId: number | null; field: string; value: string; type: string };

    const [currentState, setCurrentState] = React.useState<{
        columns: ColumnDef[];
        data: Data[];
    }>({
        columns: [],
        data: [],
    });

    const columnsDef = [
        {
            id: 'fieldId',
            name: 'Field',
            field: 'field',
            minWidth: 100,
            type: FieldType.string,
            formatter: Formatters.tree,
            cssClass: 'cell-title',
            filterable: true,
            sortable: true,
        },
        { id: 'valueId', name: 'Value', field: 'value', minWidth: 100, filterable: true },
        { id: 'typeId', name: 'Type', field: 'type', minWidth: 100, filterable: true },
    ];

    const staticDataSource = [
        { id: 1, parentId: null, field: '_id', value: '66ba10dc1b5499e8b28805d3', type: 'ObjectId' },
        { id: 11, parentId: 1, field: '_id', value: '66ba10dc1b5499e8b28805d3', type: 'ObjectId' },
        { id: 12, parentId: 1, field: 'firstName', value: 'Alan', type: 'String' },
        { id: 13, parentId: 1, field: 'lastName', value: 'Turing', type: 'String' },

        { id: 2, parentId: null, field: '_id', value: '66ba10dc1b5499e8b28805d3', type: 'ObjectId' },
        { id: 21, parentId: 2, field: '_id', value: '66ba10dc1b5499e8b28805d3', type: 'ObjectId' },
        { id: 22, parentId: 2, field: 'firstName', value: 'Alan', type: 'String' },
        { id: 23, parentId: 2, field: 'lastName', value: 'Turing', type: 'String' },
        { id: 24, parentId: 2, field: 'visited', value: 'false', type: 'Boolean' },
        { id: 25, parentId: 2, field: 'state', value: '{...}', type: 'Object' },

        { id: 251, parentId: 25, field: 'happy', value: 'true', type: 'Boolean' },
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
            columnId: 'fieldId',
            parentPropName: 'parentId',
            // // this is optional, you can define the tree level property name that will be used for the sorting/indentation, internally it will use "__treeLevel"
            levelPropName: 'treeLevel',
            indentMarginLeft: 15,
            initiallyCollapsed: true,

            // initialSort: {
            //     // tn: incredible! this is actually needed if you want to shown chevrons to expand/collapse the tree (!??? 2h+ to find this by trial&error)
            //     // https://github.com/ghiscoding/slickgrid-react/discussions/393
            //     // with the 5.5.1 release of slickgrid-react, this is no longer needed
            //     columnId: 'fieldId',
            //     direction: 'ASC',
            // },

            // we can also add a custom Formatter just for the title text portion
            titleFormatter: (_row, _cell, value, _def, dataContext) => {
                let prefix = '';
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                if (dataContext.treeLevel > 0) {
                    prefix = `<span class="mdi mdi-subdirectory-arrow-right mdi-v-align-sub color-se-secondary"></span>`;
                }
                // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/restrict-plus-operands
                return `${prefix}<span class="bold">${value}</span> <span style="font-size:11px; margin-left: 15px;">(${dataContext.parentId ? `parentId: ` + dataContext.parentId : `root: ` + dataContext.id})</span>`;
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

    React.useEffect(() => {
        // This runs after the component has mounted
        console.log('Component has mounted');

        setCurrentState((prev) => ({ ...prev, columns: columnsDef, data: staticDataSource }));

        // Optional cleanup function (similar to componentWillUnmount)
        return () => {
            console.log('Component will unmount');
        };
    }, []); // Empty dependency array means this runs only once, like componentDidMount

    return (
        <SlickgridReact
            gridId="myGridTree"
            gridOptions={gridOptions}
            columnDefinitions={currentState.columns}
            dataset={currentState.data}
            onReactGridCreated={() => console.log('Grid created')}
        />
    );
};
