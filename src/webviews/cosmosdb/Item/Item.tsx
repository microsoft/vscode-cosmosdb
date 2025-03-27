/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { useContext } from 'react';
import { WebviewContext } from '../../WebviewContext';
import { ItemPanel } from './ItemPanel';
import { WithItemContext } from './state/ItemContext';

const useStyles = makeStyles({
    root: {
        display: 'grid',
        gridTemplateRows: '100vh',
    },
});

export const Item = () => {
    const styles = useStyles();
    const { channel, vscodeApi } = useContext(WebviewContext);

    return (
        <div className={styles.root}>
            <WithItemContext channel={channel} vscodeApi={vscodeApi}>
                <ItemPanel />
            </WithItemContext>
        </div>
    );
};
