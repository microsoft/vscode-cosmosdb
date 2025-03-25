/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, makeStyles } from '@fluentui/react-components';
import { useState } from 'react';
import { useTrpcClient } from '../../api/webview-client/useTrpcClient';

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

    const { trpcClient /** , vscodeEventTarget */ } = useTrpcClient();

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

    const [currentAssessmentData, setCurrentAssessmentData] = useState<string>();

    return (
        <div className={classes.container}>
            <h1>Azure Cosmos DB Migration for MongoDB</h1>
            <p>
                This extension helps you run an end-to-end assessment on your MongoDB workload and seamlessly migrate
                your workload to Azure Cosmos DB for MongoDB
            </p>
            <Button
                appearance="primary"
                onClick={() => {
                    /**
                     * a simple call with no parameters, but with error handling.
                     * telemetry is "added " in the router for the function call
                     */
                    trpcClient.mongoMigration.getAllAssessments
                        .query()
                        .then((assessmentData) => {
                            setCurrentAssessmentData(JSON.stringify(assessmentData));
                        })
                        .catch((error) => {
                            void trpcClient.common.displayErrorMessage.mutate({
                                message: 'Error while loading the autocompletion data',
                                modal: false,
                                cause: error instanceof Error ? error.message : String(error),
                            });
                        });
                }}
            >
                {' '}
            </Button>
            <p>{currentAssessmentData}</p>
        </div>
    );
};
