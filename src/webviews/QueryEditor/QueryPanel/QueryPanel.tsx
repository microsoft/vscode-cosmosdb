import { makeStyles } from '@fluentui/react-components';
import { useContext } from 'react';
import { WebviewContext } from 'src/webviews/WebviewContext';
import { WithQueryEditorContext } from '../QueryEditorContext';
import { QueryMonaco } from './QueryMonaco';
import { QueryToolbar } from './QueryToolbar';

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
        'background-color': 'var(--vscode-editor-background)',
        width: '100%',
        height: '100%',
    },
});

export const QueryPanel = () => {
    const classes = useClasses();
    const { channel, vscodeApi } = useContext(WebviewContext);

    return (
        <section className={classes.container}>
            <WithQueryEditorContext channel={channel} vscodeApi={vscodeApi}>
                <div className={classes.toolbarContainer}>
                    <QueryToolbar />
                </div>
                <div className={classes.monacoContainer}>
                    <QueryMonaco />
                </div>
            </WithQueryEditorContext>
        </section>
    );
};
