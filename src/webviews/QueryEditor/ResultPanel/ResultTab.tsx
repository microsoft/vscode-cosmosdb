/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { Suspense, useMemo } from 'react';
import { MonacoEditor } from '../../MonacoEditor';
import { DataViewPanelTable } from '../../mongoClusters/collectionView/components/DataViewPanelTable';
import { DataViewPanelTree } from '../../mongoClusters/collectionView/components/DataViewPanelTree';
import { queryResultToJSON, queryResultToTable, queryResultToTree } from '../../utils';
import { useQueryEditorState } from '../state/QueryEditorContext';
import { ResultTableViewToolbar } from './ResultTableViewToolbar';

const useClasses = makeStyles({
    toolbarContainer: {
        marginBottom: '10px',
    },
    monacoContainer: {
        marginTop: '10px',
        width: '100%',
        height: 'calc(100% - 50px)',
    },
    container: {
        height: '100%',
    },
});

export const ResultTab = () => {
    const classes = useClasses();

    const { tableViewMode, currentQueryResult } = useQueryEditorState();

    const jsonViewData = useMemo(() => queryResultToJSON(currentQueryResult), [currentQueryResult]);
    const tableViewData = useMemo(() => queryResultToTable(currentQueryResult), [currentQueryResult]);
    const treeViewData = useMemo(() => queryResultToTree(currentQueryResult), [currentQueryResult]);

    return (
        <section className={classes.container}>
            <ResultTableViewToolbar></ResultTableViewToolbar>
            <div className={[classes.monacoContainer, 'resultsDisplayArea'].join(' ')}>
                <Suspense fallback={<div>Loading...</div>}>
                    {tableViewMode === 'Table' && (
                        <DataViewPanelTable liveData={tableViewData!.dataset} liveHeaders={tableViewData!.headers} />
                    )}
                    {tableViewMode === 'Tree' && (
                        <DataViewPanelTree
                            liveData={(treeViewData ?? []) as unknown as { [key: string]: undefined }[]}
                        />
                    )}
                    {tableViewMode === 'JSON' && (
                        <MonacoEditor
                            height={'100%'}
                            width={'100%'}
                            defaultLanguage={'json'}
                            value={jsonViewData || 'No result'}
                            options={{ domReadOnly: true, readOnly: true }}
                        />
                    )}
                </Suspense>
            </div>
        </section>
    );
};
