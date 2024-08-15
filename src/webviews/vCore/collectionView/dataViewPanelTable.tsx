import * as React from 'react';
import { SlickgridReact, type GridOption } from 'slickgrid-react';

export const DataViewPanelTable = (): React.JSX.Element => {

    type ColumnDef = { id: string; name: string; field: string; minWidth: number };
    type Data = { id: number; _id: string; firstName: string; lastName: string };

    const [currentState, setCurrentState] = React.useState<{ columns: ColumnDef[]; data: Data[] }>({
        columns: [],
        data: [],
    });

    const columnsDef = [
        { id: '_id', name: '_id', field: '_id', minWidth: 100 },
        { id: 'firstName', name: 'firstName', field: 'firstName', minWidth: 100 },
        { id: 'lastName', name: 'lastName', field: 'lastName', minWidth: 100 },
    ];

    const staticDataSource = [
        { id: 1, _id: '66ba10dc1b5499e8b28805d3', firstName: 'Alan', lastName: 'Turing' },
        { id: 18, _id: '66ba11075b531918a6ca7b29', firstName: 'Grace', lastName: 'Hopper' },
        { id: 17, _id: '66ba11075b531918a6ca7b30', firstName: 'Ada', lastName: 'Lovelace' },
        { id: 16, _id: '66ba11075b531918a6ca7b31', firstName: 'Charles', lastName: 'Babbage' },
        { id: 15, _id: '66ba11075b531918a6ca7b32', firstName: 'John', lastName: 'von Neumann' },
        { id: 14, _id: '66ba11075b531918a6ca7b33', firstName: 'Claude', lastName: 'Shannon' },
        { id: 13, _id: '66ba11075b531918a6ca7b34', firstName: 'Donald', lastName: 'Knuth' },
        { id: 12, _id: '66ba11075b531918a6ca7b35', firstName: 'Barbara', lastName: 'Liskov' },
    ];

    const gridOptions : GridOption = {
        autoResize: {
            calculateAvailableSizeBy: 'container',
            container: '.resultsDisplayArea', // this is a selector of the parent container, in this case it's the collectionView.tsx and the class is "resultsDisplayArea"
            delay: 100
        },
        enableAutoResize: true,
        //enableFiltering: true,
        enableSorting: false,
        enableCellNavigation: true,
        enableCheckboxSelector: true,
        enableRowSelection: true,
        multiSelect: false,
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
            gridId="myGrid"
            gridOptions={gridOptions}
            columnDefinitions={currentState.columns}
            dataset={currentState.data}
            onReactGridCreated={() => console.log('Grid created')}
        />
    );
};
