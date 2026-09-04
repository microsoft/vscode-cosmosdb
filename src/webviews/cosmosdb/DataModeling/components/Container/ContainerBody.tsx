/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { type JSX } from 'react';
import { useContainerContext } from '../contexts/container.js';
import { type ContainerBodyProps } from './Container.types.js';
import { useOverflowState } from './useOverflowState.js';

const useStyles = makeStyles({
    scrollArea: { flex: 1, minHeight: 0, overflowY: 'auto' },
    content: {
        display: 'grid',
        gap: '20px',
        maxWidth: '760px',
        padding: '24px',
    },
    navTop: {
        gridTemplateColumns: 'minmax(0, 1fr)',
        gridTemplateAreas: `
            "header"
            "nav"
            "main"
        `,
    },
    navStart: {
        gridTemplateColumns: 'auto minmax(0, 1fr)',
        gridTemplateAreas: `
            "header header"
            "nav    main"
        `,
    },
});

/**
 * The scrolling region of a {@link Container}, and the content column inside it.
 *
 * It is the *only* scroll container on the surface. The header scrolls away with the content
 * because it is a child of this element; only the footer is pinned. A consumer who wants a pinned
 * header puts `ContainerHeader` directly under `Container` instead.
 *
 * Regions are placed by name, so the markup is identical in both orientations: only
 * {@link ContainerBodyProps.navPosition} changes. Every declared region reserves its row, so a
 * surface that omits one leaves that row's gap behind; supply all three, or set `className` to
 * override the template.
 *
 * It measures its own overflow and publishes it, which is what lets `ContainerFooter` elevate
 * itself with no consumer wiring.
 */
export const ContainerBody = ({
    children,
    className,
    navPosition = 'top',
    ...rest
}: ContainerBodyProps): JSX.Element => {
    const styles = useStyles();
    const { setOverflowing } = useContainerContext();
    const { scrollRef, contentRef, handleScroll } = useOverflowState(setOverflowing);

    return (
        <div className={mergeClasses(styles.scrollArea, className)} ref={scrollRef} onScroll={handleScroll} {...rest}>
            <div
                ref={contentRef}
                className={mergeClasses(styles.content, navPosition === 'start' ? styles.navStart : styles.navTop)}
            >
                {children}
            </div>
        </div>
    );
};
