/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { useContext } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { useHotkeyScope } from '../../common/hotkeys';
import { WebviewContext } from '../../WebviewContext';
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
    },
    panelResizeHandle: {
        height: '1px',
        width: '100%',
        position: 'relative',
        cursor: 'row-resize',

        // Expand the interactive area without affecting layout
        '&::before': {
            position: 'absolute',
            content: '""',
            width: '100%',
            top: '-4px', // Extend 4px above
            bottom: '-4px', // Extend 4px below (total 8px + 1px = 9px interactive area)
            backgroundColor: 'transparent',
            zIndex: 1,
        },

        // Visual indicator
        '&::after': {
            position: 'absolute',
            content: '""',
            width: '100%',
            top: '50%',
            transform: 'translateY(-50%)',
            height: '1px',
            backgroundColor: 'rgba(128, 128, 128, 0.35)',
            pointerEvents: 'none',
            transition: 'background-color 0.2s ease-out',
        },

        '&:hover::after': {
            height: '4px',
            backgroundColor: '#007fd4',
        },
    },
});

export const QueryEditor = () => {
    const styles = useStyles();
    const { channel, vscodeApi } = useContext(WebviewContext);

    // Set up the hotkey scope for the global context
    useHotkeyScope<QueryEditorHotkeyScope, QueryEditorHotkeyCommand>('global', QueryEditorGlobalHotkeys);

    return (
        <div className={styles.root}>
            <WithQueryEditorContext channel={channel} vscodeApi={vscodeApi}>
                <PanelGroup direction={'vertical'}>
                    <Panel minSize={10} maxSize={80} defaultSize={20}>
                        <QueryPanel />
                    </Panel>
                    <PanelResizeHandle className={styles.panelResizeHandle} />
                    <Panel defaultSize={80}>
                        <ResultPanel />
                    </Panel>
                </PanelGroup>
            </WithQueryEditorContext>
        </div>
    );
};
