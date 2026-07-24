/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Where the Quick Start popover is anchored relative to its target element.
 * Mirrors the subset of Fluent UI `PositioningShorthand` values we support.
 */
export type QuickStartTipPosition =
    | 'above'
    | 'below'
    | 'before'
    | 'after'
    | 'above-start'
    | 'above-end'
    | 'below-start'
    | 'below-end';

/**
 * A single Quick Start tip. Authored in a webview-side registry (TSX) so its
 * user-facing strings can be localized via `l10n.t()`.
 *
 * The shape is intentionally primitive-only (no React nodes, no DOM, no VS Code
 * APIs) so the pure state logic in `quickStartState.ts` can operate on it and be
 * unit-tested in isolation, and so the extension host can reason about tip ids
 * without pulling in the webview bundle.
 */
export interface QuickStartTip {
    /**
     * Stable, unique identifier. Used as the persistence key for "seen" state —
     * NEVER reuse or repurpose an id, or returning users may miss a new tip or
     * re-see an old one. Adding a brand new id is how a tip becomes "new" after
     * an extension update.
     */
    id: string;
    /**
     * Logical grouping (e.g. a feature area). Drives `isGroupComplete` and the
     * staged flow: each group is surfaced at a different moment (the `editor`
     * group when the editor opens, the `result` group after the first query).
     * Omit it for "ungrouped" intro tips, which are shown before any group.
     */
    group?: string;
    /** Localized popover title. */
    title: string;
    /** Localized popover body text. */
    body: string;
    /**
     * CSS selector for the element the popover anchors to. Prefer a stable
     * `[data-quickstart="<id>"]` attribute over structural/class selectors.
     */
    targetSelector: string;
    /** Preferred popover direction relative to the target. Defaults to `below`. */
    position?: QuickStartTipPosition;
    /**
     * Optional explicit ordering hint. When omitted, registry array order is
     * used. Lower numbers come first.
     */
    order?: number;
}
