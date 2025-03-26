/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { useContext } from 'react';
import { WebviewContext } from '../../WebviewContext';
import { DocumentPanel } from './DocumentPanel';
import { WithDocumentContext } from './state/DocumentContext';

const useStyles = makeStyles({
    root: {
        display: 'grid',
        gridTemplateRows: '100vh',
    },
});

export const Document = () => {
    const styles = useStyles();
    const { channel, vscodeApi } = useContext(WebviewContext);

    return (
        <div className={styles.root}>
            <WithDocumentContext channel={channel} vscodeApi={vscodeApi}>
                <DocumentPanel />
            </WithDocumentContext>
        </div>
    );
};
