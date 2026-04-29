/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { Allotment } from 'allotment';
import 'allotment/dist/style.css';
import { useHotkeyScope } from '../../common/hotkeys';
import {
    QueryEditorGlobalHotkeys,
    type QueryEditorHotkeyCommand,
    type QueryEditorHotkeyScope,
} from './QueryEditorHotkeys';
import { QueryPanel } from './QueryPanel/QueryPanel';
import { ResultPanel } from './ResultPanel/ResultPanel';
import { WithQueryEditorContext } from './state/QueryEditorContext';

const useStyles = makeStyles({
    root: {
        display: 'grid',
        gridTemplateRows: '100vh',
        // minWidth: '520px',
    },
});

export const QueryEditor = () => {
    const styles = useStyles();

    // Set up the hotkey scope for the global context
    useHotkeyScope<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('global', QueryEditorGlobalHotkeys);

    return (
        <div className={styles.root}>
            <WithQueryEditorContext>
                <Allotment vertical={true} defaultSizes={[30, 70]}>
                    <Allotment.Pane minSize={100} maxSize={800} preferredSize={'30%'}>
                        <QueryPanel />
                    </Allotment.Pane>
                    <Allotment.Pane preferredSize={'70%'}>
                        <ResultPanel />
                    </Allotment.Pane>
                </Allotment>
            </WithQueryEditorContext>
        </div>
    );
};
