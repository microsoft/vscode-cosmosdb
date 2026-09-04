/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { type JSX } from 'react';
import { type ContainerMainProps } from './Container.types.js';

const useStyles = makeStyles({
    main: { gridArea: 'main', display: 'flex', flexDirection: 'column', gap: '20px', minWidth: 0 },
});

/**
 * The `main` landmark: the current step's content. Holds any number of children, which is the
 * whole reason the regions are components rather than grid areas carried by the content itself.
 */
export const ContainerMain = ({ children, className, ...rest }: ContainerMainProps): JSX.Element => {
    const styles = useStyles();

    return (
        <main className={mergeClasses(styles.main, className)} {...rest}>
            {children}
        </main>
    );
};
