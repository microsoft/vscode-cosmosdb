import * as React from 'react';
import { FieldType, Formatters, SlickgridReact, type GridOption } from 'slickgrid-react';

export const DataViewPanelTree = (): React.JSX.Element => {
    type ColumnDef = { id: string; name: string; field: string; minWidth: number };
    type Data = { id: number; name: string; value: string; type: string };

    const [currentState, setCurrentState] = React.useState<{ columns: ColumnDef[]; data: Data[] }>({
        columns: [],
        data: [],
    });

    const columnsDef = [
        { id: 'name', name: 'Field', field: 'name', minWidth: 100, type: FieldType.string, formatter: Formatters.tree },
        { id: 'value', name: 'Value', field: 'value', minWidth: 100 },
        { id: 'type', name: 'Type', field: 'type', minWidth: 100 },
    ];

    const staticDataSource = [
        { id: 1, name: '_id', value: '66ba10dc1b5499e8b28805d3', type: 'ObjectId' },
        { id: 11, parentId: 1, name: '_id', value: '66ba10dc1b5499e8b28805d3', type: 'ObjectId' },
        { id: 12, parentId: 1, name: 'firstName', value: 'Alan', type: 'String' },
        { id: 13, parentId: 1, name: 'lastName', value: 'Turing', type: 'String' },

        { id: 2, name: '_id', value: '66ba10dc1b5499e8b28805d3', type: 'ObjectId' },
        { id: 21, parentId: 2, name: '_id', value: '66ba10dc1b5499e8b28805d3', type: 'ObjectId' },
        { id: 22, parentId: 2, name: 'firstName', value: 'Alan', type: 'String' },
        { id: 23, parentId: 2, name: 'lastName', value: 'Turing', type: 'String' },
        { id: 24, parentId: 2, name: 'visited', value: 'false', type: 'Boolean' },
        { id: 25, parentId: 2, name: 'state', value: '{...}', type: 'Object' },
        { id: 251, parentId: 25, name: 'happy', value: 'true', type: 'Boolean' },
    ];

    const gridOptions: GridOption = {
        enableFiltering: true,
        gridHeight: 600,
        gridWidth: '100%',
        // enableAutoRetype: true,
        enableSorting: false,

        enableTreeData: true, // you must enable this flag for the filtering & sorting to work as expected

        treeDataOptions: {
            columnId: 'name',
            parentPropName: 'parentId',
            // // this is optional, you can define the tree level property name that will be used for the sorting/indentation, internally it will use "__treeLevel"
            levelPropName: 'treeLevel',
            indentMarginLeft: 15,
            initiallyCollapsed: true,

            // you can optionally sort by a different column and/or sort direction
            // this is the recommend approach, unless you are 100% that your original array is already sorted (in most cases it's not)
            // initialSort: {
            //   columnId: 'title',
            //   direction: 'ASC'
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
    };

    React.useEffect(() => {
        // This runs after the component has mounted
        console.log('Component has mounted');

        setCurrentState({ columns: columnsDef, data: staticDataSource });

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
