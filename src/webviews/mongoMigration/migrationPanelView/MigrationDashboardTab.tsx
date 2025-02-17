/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from '@fluentui/react-components';
// import { useQueryEditorState } from '../state/QueryEditorContext';
// import { ResultTabViewJson } from './ResultTabViewJson';
// import { ResultTabViewTable } from './ResultTabViewTable';
// import { ResultTabViewTree } from './ResultTabViewTree';


const useClasses = makeStyles({
    container: {
        marginTop: '10px',
        height: 'calc(100% - 10px)',
        width: '100%',
    },
});

export const MigrationDashboardTab = () => {
    const classes = useClasses();

    // const { tableViewMode, currentQueryResult, partitionKey } = useQueryEditorState();

    // const jsonViewData = useMemo(() => queryResultToJSON(currentQueryResult), [currentQueryResult]);
    // const tableViewData = useMemo(
    //     () => queryResultToTable(currentQueryResult, partitionKey),
    //     [currentQueryResult, partitionKey],
    // );
    // const treeViewData = useMemo(
    //     () => queryResultToTree(currentQueryResult, partitionKey),
    //     [currentQueryResult, partitionKey],
    // );

    return (
        <div className={classes.container}>
            <h1>Azure Cosmos DB Migration for MongoDB</h1>
            <p>This extension helps you run an end-to-end assessment on your MongoDB workload
                and seamlessly migrate your workload to Azure Cosmos DB for MongoDB
            </p>
            <Button appearance="primary">Assessment</Button>

        </div>
    );
};
