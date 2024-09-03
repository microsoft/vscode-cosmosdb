import { makeStyles } from '@fluentui/react-components';
import { Allotment } from 'allotment';
// eslint-disable-next-line import/no-internal-modules
import 'allotment/dist/style.css';
import { useContext } from 'react';
import { WebviewContext } from '../WebviewContext';
import { WithQueryEditorContext } from './QueryEditorContext';
import { QueryPanel } from './QueryPanel/QueryPanel';
import { ResultPanel } from './ResultPanel/ResultPanel';

// this is the 'fluent ui' way of doing this, left in here so that the demo code is executed,
// work with scss if possible for easier management
const useStyles = makeStyles({
    root: {
        display: 'grid',
        gridTemplateRows: '100vh',
    },
});

export const QueryEditor = () => {
    const styles = useStyles();
    const { channel, vscodeApi } = useContext(WebviewContext);

    return (
        <div className={styles.root}>
            <WithQueryEditorContext channel={channel} vscodeApi={vscodeApi}>
                <Allotment vertical={true} defaultSizes={[20, 80]}>
                    <Allotment.Pane minSize={400} maxSize={800} preferredSize={'20%'}>
                        <QueryPanel />
                    </Allotment.Pane>
                    <Allotment.Pane preferredSize={'80%'}>
                        <ResultPanel />
                    </Allotment.Pane>
                </Allotment>
            </WithQueryEditorContext>
        </div>
    );
};
