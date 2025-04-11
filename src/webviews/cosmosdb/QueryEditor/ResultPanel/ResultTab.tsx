/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { Suspense, useEffect, useState } from 'react';
import { type TreeData } from '../../../../utils/slickgrid/mongo/toSlickGridTree';
import { queryResultToJSON, queryResultToTable, queryResultToTree, type TableData } from '../../../utils';
import { useQueryEditorState } from '../state/QueryEditorContext';
import { ResultTabViewJson } from './ResultTabViewJson';
import { ResultTabViewTable } from './ResultTabViewTable';
import { ResultTabViewTree } from './ResultTabViewTree';

const useClasses = makeStyles({
    container: {
        marginTop: '10px',
        height: 'calc(100% - 10px)',
        width: '100%',
    },
    loaderContainer: {
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100%',
        width: '100%',
    },
});

type ViewData = {
    json?: string;
    table?: TableData;
    tree?: TreeData[];
};

export const ResultTab = () => {
    const classes = useClasses();
    const { tableViewMode, currentQueryResult, partitionKey } = useQueryEditorState();
    const [viewData, setViewData] = useState<ViewData>({});
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        // Skip if no query result
        if (!currentQueryResult) return;

        // Set loading state while calculating
        setIsLoading(true);

        // Calculate only for the current view mode
        // eslint-disable-next-line @typescript-eslint/no-misused-promises
        const timer = setTimeout(async () => {
            try {
                switch (tableViewMode) {
                    case 'Table':
                        if (!viewData.table) {
                            const tableData = await queryResultToTable(currentQueryResult, partitionKey);
                            setViewData((prev) => ({
                                ...prev,
                                table: tableData,
                            }));
                        }
                        break;
                    case 'Tree':
                        if (!viewData.tree) {
                            const treeData = await queryResultToTree(currentQueryResult, partitionKey);
                            setViewData((prev) => ({
                                ...prev,
                                tree: treeData,
                            }));
                        }
                        break;
                    case 'JSON':
                        if (!viewData.json) {
                            const jsonData = queryResultToJSON(currentQueryResult);
                            setViewData((prev) => ({
                                ...prev,
                                json: jsonData,
                            }));
                        }
                        break;
                }
            } finally {
                setIsLoading(false);
            }
        }, 100);

        return () => clearTimeout(timer);
    }, [tableViewMode, currentQueryResult, partitionKey]);

    // Clear cached data when query result changes
    useEffect(() => {
        setViewData({});
    }, [currentQueryResult, partitionKey]);

    return (
        <div className={[classes.container, 'resultsDisplayArea'].join(' ')}>
            <Suspense fallback={<div>{l10n.t('Loading…')}</div>}>
                {isLoading ? (
                    <div className={classes.loaderContainer}>
                        <Spinner labelPosition="below" label="Loading…" />
                    </div>
                ) : (
                    <>
                        {tableViewMode === 'Table' && (
                            <ResultTabViewTable
                                headers={viewData.table?.headers ?? []}
                                dataset={viewData.table?.dataset ?? []}
                            />
                        )}
                        {tableViewMode === 'Tree' && <ResultTabViewTree data={viewData.tree ?? []} />}
                        {tableViewMode === 'JSON' && <ResultTabViewJson data={viewData.json ?? ''} />}
                    </>
                )}
            </Suspense>
        </div>
    );
};
