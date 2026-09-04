/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ComponentPropsWithoutRef, type ReactNode } from 'react';

/** Where the step indicator sits relative to the step content. Logical, so RTL comes free. */
export type ContainerNavPosition = 'top' | 'start';

/**
 * The root of the surface. Owns the full-height column and the positioning context that
 * visually-hidden descendants need.
 */
export type ContainerProps = ComponentPropsWithoutRef<'div'>;

export interface ContainerBodyProps extends ComponentPropsWithoutRef<'div'> {
    /**
     * Where `ContainerNav` sits. `'top'` stacks header, nav and main; `'start'` puts the nav in
     * its own column beside main, with the header spanning both.
     * @default 'top'
     */
    readonly navPosition?: ContainerNavPosition;
}

export interface ContainerHeaderProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
    /** Icon or image identifying the surface. Rendered in a fixed 56 × 56 box; omitting it collapses the box. */
    readonly media?: ReactNode;
    readonly title: ReactNode;
    readonly subtitle?: ReactNode;
    /** End-aligned trailing content, e.g. a settings button. */
    readonly action?: ReactNode;
    /**
     * Heading level of {@link title}. Drop to `2` when the surface is embedded under an existing
     * `h1`.
     * @default 1
     */
    readonly headingLevel?: 1 | 2;
}

/** Placement only: the region that holds the step indicator. */
export type ContainerNavProps = ComponentPropsWithoutRef<'div'>;

/** The `main` landmark: the region that holds the current step's content. */
export type ContainerMainProps = ComponentPropsWithoutRef<'main'>;

export interface ContainerSectionProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title'> {
    /** Section heading. Wired to the section's `aria-labelledby`. */
    readonly title?: ReactNode;
    /** One line of guidance under the heading. */
    readonly subtitle?: ReactNode;
    /** End-aligned trailing content on the heading row. */
    readonly action?: ReactNode;
    /**
     * Move focus to the heading when this section mounts, so keyboard and screen-reader users land
     * on the new content instead of falling back to `<body>` (WCAG 2.4.3). Suppressed on the
     * surrounding `Container`'s first render, where nothing has changed yet.
     */
    readonly focusOnMount?: boolean;
    /** @default 2 */
    readonly headingLevel?: 2 | 3;
}

export interface ContainerFooterProps extends ComponentPropsWithoutRef<'div'> {
    /** Info icon plus small text, above the actions row. States what the primary action does. */
    readonly note?: ReactNode;
    /** End-aligned trailing content on the actions row, e.g. a "Learn more" button. */
    readonly contentEnd?: ReactNode;
    /** The action buttons, in reading order: primary first. */
    readonly children?: ReactNode;
}
