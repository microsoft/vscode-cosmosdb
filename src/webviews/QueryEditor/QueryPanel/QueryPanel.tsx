/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from '@fluentui/react-components';
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

    return (
        <section className={classes.container}>
            <div className={classes.toolbarContainer}>
                <QueryToolbar />
            </div>
            <div className={classes.monacoContainer}>
                <QueryMonaco />
            </div>
        </section>
    );
};
