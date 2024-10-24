/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { Suspense, useMemo } from 'react';
import { queryResultToJSON, queryResultToTable, queryResultToTree } from '../../utils';
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
});

export const ResultTab = () => {
    const classes = useClasses();

    const { tableViewMode, currentQueryResult, partitionKey } = useQueryEditorState();

    const jsonViewData = useMemo(() => queryResultToJSON(currentQueryResult), [currentQueryResult]);
    const tableViewData = useMemo(
        () => queryResultToTable(currentQueryResult, partitionKey),
        [currentQueryResult, partitionKey],
    );
    const treeViewData = useMemo(
        () => queryResultToTree(currentQueryResult, partitionKey),
        [currentQueryResult, partitionKey],
    );

    return (
        <div className={[classes.container, 'resultsDisplayArea'].join(' ')}>
            <Suspense fallback={<div>Loading...</div>}>
                {tableViewMode === 'Table' && <ResultTabViewTable {...tableViewData} />}
                {tableViewMode === 'Tree' && <ResultTabViewTree data={treeViewData ?? []} />}
                {tableViewMode === 'JSON' && <ResultTabViewJson data={jsonViewData} />}
            </Suspense>
        </div>
    );
};
