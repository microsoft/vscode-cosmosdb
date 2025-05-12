/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { Suspense, useEffect, useRef, useState } from 'react';
import {
    queryResultToJSON,
    queryResultToTable,
    queryResultToTree,
    type TableData,
    type TreeData,
} from '../../../utils';
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
    screenReaderOnly: {
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: '0',
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 'false',
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
    const [resultCount, setResultCount] = useState<number>(0);
    const previousLoadingState = useRef(false);

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

    // Calculate and set result count when loading completes
    useEffect(() => {
        if (previousLoadingState.current && !isLoading) {
            // Loading just completed, update result count based on view mode
            let count = 0;
            if (tableViewMode === 'Table' && viewData.table) {
                count = viewData.table.dataset.length;
            } else if (tableViewMode === 'Tree' && viewData.tree) {
                count = viewData.tree.length;
            } else if (tableViewMode === 'JSON' && viewData.json) {
                // For JSON view, count top-level items if it's an array, otherwise just show 1
                try {
                    const parsedJson = JSON.parse(viewData.json) as unknown;
                    count = Array.isArray(parsedJson) ? parsedJson.length : 1;
                } catch {
                    count = 0;
                }
            }
            setResultCount(count);
        }

        previousLoadingState.current = isLoading;
    }, [isLoading, viewData, tableViewMode]);

    return (
        <div className={[classes.container, 'resultsDisplayArea'].join(' ')}>
            {/* Add an ARIA live region to announce results count */}
            <div className={classes.screenReaderOnly} aria-live="polite" aria-atomic="true">
                {!isLoading && resultCount > 0 ? l10n.t('Query complete. {0} results displayed.', resultCount) : ''}
            </div>
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
