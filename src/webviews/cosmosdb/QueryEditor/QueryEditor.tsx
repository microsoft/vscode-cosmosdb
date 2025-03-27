/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { Allotment } from 'allotment';
// eslint-disable-next-line import/no-internal-modules
import 'allotment/dist/style.css';
import { useContext } from 'react';
import { WebviewContext } from '../../WebviewContext';
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
    const { channel, vscodeApi } = useContext(WebviewContext);
    return (
        <div className={styles.root}>
            <WithQueryEditorContext channel={channel} vscodeApi={vscodeApi}>
                <Allotment vertical={true} defaultSizes={[20, 80]}>
                    <Allotment.Pane minSize={100} maxSize={800} preferredSize={'20%'}>
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
