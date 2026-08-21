/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { type JSX } from 'react';
import { type ContainerNavProps } from './Container.types.js';

const useStyles = makeStyles({
    // `minWidth: 0` is load-bearing: without it a grid item refuses to shrink below its content,
    // and the step indicator's own overflow handling never engages.
    nav: { gridArea: 'nav', minWidth: 0 },
});

/** Placement for the step indicator. It carries no styling of its own beyond its grid area. */
export const ContainerNav = ({ children, className, ...rest }: ContainerNavProps): JSX.Element => {
    const styles = useStyles();

    return (
        <div className={mergeClasses(styles.nav, className)} {...rest}>
            {children}
        </div>
    );
};
