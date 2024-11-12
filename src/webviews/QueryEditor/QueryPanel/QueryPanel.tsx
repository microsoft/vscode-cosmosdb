/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
import { QueryMonaco } from './QueryMonaco';
import { QueryToolbar } from './QueryToolbar';

const useClasses = makeStyles({
    monacoContainer: {
        marginTop: '10px',
        width: '100%',
        height: 'calc(100% - 50px)', // Toolbar height is 40px + 10px margin
    },
    container: {
        'background-color': 'var(--vscode-editor-background)',
        marginTop: '10px',
        width: '100%',
        height: 'calc(100% - 10px)', // 10px margin
    },
});

export const QueryPanel = () => {
    const classes = useClasses();

    return (
        <section className={classes.container}>
            <QueryToolbar />
            <section className={classes.monacoContainer}>
                <QueryMonaco />
            </section>
        </section>
    );
};
