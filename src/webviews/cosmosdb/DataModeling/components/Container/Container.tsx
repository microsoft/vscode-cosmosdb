/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses } from '@fluentui/react-components';
import { type JSX, useCallback, useMemo, useState } from 'react';
import { ContainerContext, type ContainerContextValue } from '../contexts/container.js';
import { useIsFirstRender } from '../utils/useIsFirstRender.js';
import { type ContainerProps } from './Container.types.js';

const useStyles = makeStyles({
    root: {
        display: 'flex',
        flexDirection: 'column',
        // Viewport-height rather than `100%`: the surface is the window, and a host that has not
        // given `html`/`body` a height would otherwise collapse it to nothing.
        height: '100vh',
        overflow: 'hidden',
        // Containing block for absolutely-positioned descendants (visually-hidden status text).
        position: 'relative',
    },
});

/**
 * Root of a full-window surface: a header and content that scroll, over a footer that does not.
 *
 * Fluent's own surfaces, `Dialog` and `Drawer`, all assume an overlay above existing application
 * chrome. This is the shape for a surface that *is* the window.
 *
 * ```tsx
 * <Container>
 *     <ContainerBody>
 *         <ContainerHeader title="…" />
 *         <ContainerNav>…</ContainerNav>
 *         <ContainerMain>
 *             <ContainerSection title="…">…</ContainerSection>
 *         </ContainerMain>
 *     </ContainerBody>
 *     <ContainerFooter>…</ContainerFooter>
 * </Container>
 * ```
 *
 * A direct child other than `ContainerBody` or `ContainerFooter` becomes another row of the
 * column, which is how a consumer pins the header: place `ContainerHeader` here instead of
 * inside the body.
 */
export const Container = ({ children, className, ...rest }: ContainerProps): JSX.Element => {
    const styles = useStyles();
    const isFirstRenderRef = useIsFirstRender();
    const [overflowing, setOverflowing] = useState(false);

    const setOverflowingStable = useCallback((next: boolean): void => setOverflowing(next), []);
    const value = useMemo<ContainerContextValue>(
        () => ({ isFirstRenderRef, overflowing, setOverflowing: setOverflowingStable }),
        [isFirstRenderRef, overflowing, setOverflowingStable],
    );

    return (
        <ContainerContext.Provider value={value}>
            <div className={mergeClasses(styles.root, className)} {...rest}>
                {children}
            </div>
        </ContainerContext.Provider>
    );
};
