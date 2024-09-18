import { makeStyles } from '@fluentui/react-components';
import { Suspense, useMemo } from 'react';
import { DataViewPanelTable } from '../../mongoClusters/collectionView/components/DataViewPanelTable';
import { DataViewPanelTree } from '../../mongoClusters/collectionView/components/DataViewPanelTree';
import { queryResultToJSON, queryResultToTable, queryResultToTree } from '../../utils';
import { useQueryEditorState } from '../state/QueryEditorContext';
import { DataViewPanelJSON } from './DataViewPanelJSON';
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
            <div className={classes.monacoContainer}>
                <Suspense fallback={<div>Loading...</div>}>
                    {tableViewMode === 'Table' && (
                        <DataViewPanelTable
                            liveData={tableViewData!.dataset}
                            liveHeaders={tableViewData!.headers}
                        ></DataViewPanelTable>
                    )}
                    {tableViewMode === 'Tree' && (
                        <DataViewPanelTree
                            liveData={(treeViewData ?? []) as unknown as { [key: string]: undefined }[]}
                        ></DataViewPanelTree>
                    )}
                    {tableViewMode === 'JSON' && (
                        <DataViewPanelJSON value={jsonViewData || 'No result'}></DataViewPanelJSON>
                    )}
                </Suspense>
            </div>
        </section>
    );
};
