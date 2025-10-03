/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, Spinner } from '@fluentui/react-components';
import * as l10n from '@vscode/l10n';
import { useEffect, useState } from 'react';
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

interface ResultTabProps {
    className?: string | undefined;
}

export const ResultTab = ({ className }: ResultTabProps) => {
    const classes = useClasses();
    const { tableViewMode, currentQueryResult, partitionKey, isExecuting } = useQueryEditorState();
    const [viewData, setViewData] = useState<ViewData>({});
    const [isLoading, setIsLoading] = useState(false);
    const [resultCount, setResultCount] = useState<number>(0);
    const [hasPreviousData, setHasPreviousData] = useState<boolean>(false);

    // Remove the second useEffect entirely and modify the first one
    useEffect(() => {
        // Skip if no query result
        if (!currentQueryResult || currentQueryResult.documents.length === 0) {
            setViewData({});
            setResultCount(-1);
            if (!isExecuting) {
                setIsLoading(false);
                setHasPreviousData(false);
            } else {
                setIsLoading(true);
            }
            return;
        }

        setHasPreviousData(true);
        // Set loading state first
        setIsLoading(true);
        // Update result count
        setResultCount(currentQueryResult?.documents.length ?? -1);

        // Create an abort controller to cancel operations if needed
        const abortController = new AbortController();
        const signal = abortController.signal;

        // Check if data for current view mode needs calculation
        const needsCalculation =
            (tableViewMode === 'Table' && !viewData.table) ||
            (tableViewMode === 'Tree' && !viewData.tree) ||
            (tableViewMode === 'JSON' && !viewData.json);

        // Only calculate if needed
        if (needsCalculation) {
            // Async calculation function with proper error handling
            const calculateData = async () => {
                try {
                    // Wait a short time before starting calculation
                    await new Promise((resolve) => setTimeout(resolve, 100));

                    // Check if operation was aborted
                    if (signal.aborted) return;

                    switch (tableViewMode) {
                        case 'Table': {
                            const newData = await queryResultToTable(currentQueryResult, partitionKey);
                            if (!signal.aborted) {
                                setViewData((prev) => ({ ...prev, table: newData }));
                            }
                            break;
                        }
                        case 'Tree': {
                            const newData = await queryResultToTree(currentQueryResult, partitionKey);
                            if (!signal.aborted) {
                                setViewData((prev) => ({ ...prev, tree: newData }));
                            }
                            break;
                        }
                        case 'JSON': {
                            const newData = queryResultToJSON(currentQueryResult);
                            if (!signal.aborted) {
                                setViewData((prev) => ({ ...prev, json: newData }));
                            }
                            break;
                        }
                    }
                } catch (error) {
                    if (!signal.aborted) {
                        console.error('Error calculating view data:', error);
                    }
                } finally {
                    if (!signal.aborted) {
                        setIsLoading(false);
                    }
                }
            };

            void calculateData();
        } else {
            setIsLoading(false);
        }

        // Cleanup function
        return () => {
            abortController.abort();
        };
    }, [tableViewMode, currentQueryResult, partitionKey, viewData.table, viewData.tree, viewData.json, isExecuting]);

    if (!currentQueryResult || currentQueryResult.documents.length === 0) {
        return (
            <div className={[classes.container, 'resultsDisplayArea', className].join(' ')}>
                <div className={classes.screenReaderOnly} aria-live="polite" aria-atomic="true">
                    {l10n.t('No results to display.')}
                </div>
                <div className={classes.loaderContainer}>
                    {hasPreviousData || isLoading ? (
                        <div className={classes.loaderContainer}>
                            <Spinner labelPosition="below" label="Loading…" />
                        </div>
                    ) : (
                        <div>{l10n.t('No results to display.')}</div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className={[classes.container, 'resultsDisplayArea', className].join(' ')}>
            {/* Add an ARIA live region to announce results count */}
            <div className={classes.screenReaderOnly} aria-live="polite" aria-atomic="true">
                {!isLoading && resultCount > -1 ? l10n.t('Query complete. {0} results displayed.', resultCount) : ''}
            </div>
            {isLoading ? (
                <div className={classes.loaderContainer}>
                    <Spinner labelPosition="below" label={l10n.t('Loading…')} />
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
        </div>
    );
};
