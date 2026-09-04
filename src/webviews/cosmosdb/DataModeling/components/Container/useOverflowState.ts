/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type RefObject, useCallback, useEffect, useRef } from 'react';

export interface OverflowState {
    /** Attach to the scrolling element. */
    readonly scrollRef: RefObject<HTMLDivElement | null>;
    /** Attach to the element that grows inside it. */
    readonly contentRef: RefObject<HTMLDivElement | null>;
    /** Attach to the scrolling element's `onScroll`. */
    readonly handleScroll: () => void;
}

/**
 * Reports whether a scroll region still has content below the fold.
 *
 * Three triggers, because no single one covers the cases: the user scrolls, the region or its
 * content resizes, and the content changes without changing size. The last is why the measurement
 * also runs after every render. That is cheap, and it is what makes a step change re-measure
 * without the caller having to name a dependency.
 *
 * The `- 1` absorbs the sub-pixel difference a fractional device pixel ratio leaves behind, which
 * would otherwise report a fully-scrolled region as still overflowing.
 */
export const useOverflowState = (onOverflowChange: (overflowing: boolean) => void): OverflowState => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);

    // Read through a ref so the observer is wired once, whatever the caller passes. Synced in an
    // effect rather than during render, and declared first so it lands before the measure below.
    const onOverflowChangeRef = useRef(onOverflowChange);
    useEffect(() => {
        onOverflowChangeRef.current = onOverflowChange;
    });

    const measure = useCallback((): void => {
        const scroll = scrollRef.current;
        if (scroll) {
            onOverflowChangeRef.current(scroll.scrollTop + scroll.clientHeight < scroll.scrollHeight - 1);
        }
    }, []);

    useEffect(() => {
        const scroll = scrollRef.current;
        const content = contentRef.current;
        if (!scroll || !content || typeof ResizeObserver === 'undefined') {
            return;
        }
        // The scroll region resizes when the footer does, so watching it and the content is enough.
        const observer = new ResizeObserver(() => measure());
        observer.observe(scroll);
        observer.observe(content);
        return () => observer.disconnect();
    }, [measure]);

    // Intentionally dependency-free: re-measure whatever caused this render.
    useEffect(measure);

    return { scrollRef, contentRef, handleScroll: measure };
};
