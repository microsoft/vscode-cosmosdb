/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Declarative control over which VS Code "chrome" parts are visible during an
 * e2e test — the primary side bar, the secondary side bar (where GitHub
 * Copilot Chat lives), and the bottom panel.
 *
 * Why this exists
 * ---------------
 * VS Code is **worker-scoped** in this suite (one launch reused across every
 * test — see `fixtures/vscode.ts`), and the worker activation handshake opens
 * the Azure side bar. On a fresh install the Copilot Chat secondary side bar
 * can also auto-pop. Both steal horizontal space and clutter the window
 * screenshots we attach for webview tests.
 *
 * `seedUserSettings()` already sets `workbench.secondarySideBar.visible: false`
 * as a first line of defense, but settings are applied once at launch and don't
 * give a per-test override. This helper closes that gap: it enforces a desired
 * layout at runtime, per test, and is exposed both as the auto-applied `layout`
 * Playwright option (see `fixtures/vscode.ts`) and as a direct function a spec
 * can call inline.
 *
 * How it works
 * ------------
 * For each part the caller cares about, we read the part's current visibility
 * from the workbench DOM and only issue the corresponding "toggle" command
 * (via the command palette) when the current state differs from the desired
 * one. That keeps the operation idempotent despite the shared, reused window —
 * re-applying the same layout across tests is a no-op.
 */

import { type Page } from '@playwright/test';
import { runCommand } from '../fixtures/webviewHelpers';

/**
 * Desired visibility of the configurable VS Code chrome parts.
 *
 * Each key is **tri-state**:
 *   - `undefined` — leave the part as-is (don't touch it)
 *   - `true`      — ensure the part is visible
 *   - `false`     — ensure the part is hidden
 *
 * This makes overrides additive: a test can flip a single part without having
 * to restate the rest of {@link DEFAULT_LAYOUT}.
 */
export interface WindowLayout {
    /** The primary (left) side bar — Explorer / Azure tree, etc. */
    primarySideBar?: boolean;
    /** The secondary (right) side bar — where GitHub Copilot Chat docks. */
    secondarySideBar?: boolean;
    /** The bottom panel — Terminal / Problems / Output, etc. */
    panel?: boolean;
}

/**
 * Default layout applied to every test that doesn't override it: hide the
 * Copilot Chat secondary side bar and the bottom panel so webview screenshots
 * are clean. The primary side bar is intentionally left untouched (the worker
 * activation handshake opens it, and tree-dependent specs rely on it).
 */
export const DEFAULT_LAYOUT: WindowLayout = {
    secondarySideBar: false,
    panel: false,
};

interface PartDescriptor {
    /** Workbench DOM selector for the part container. */
    selector: string;
    /** Command palette title of the visibility-toggle command (English UI). */
    toggleCommandTitle: string;
}

/**
 * The three configurable parts, keyed by {@link WindowLayout} field.
 *
 * Selectors target the stable `.part.*` workbench containers. Toggle command
 * titles match the English command palette labels — consistent with the rest
 * of the suite, which already drives the palette by English title (e.g.
 * `View: Show Azure`).
 */
const PARTS: Record<keyof WindowLayout, PartDescriptor> = {
    primarySideBar: {
        selector: '.monaco-workbench .part.sidebar',
        toggleCommandTitle: 'View: Toggle Primary Side Bar Visibility',
    },
    secondarySideBar: {
        selector: '.monaco-workbench .part.auxiliarybar',
        toggleCommandTitle: 'View: Toggle Secondary Side Bar Visibility',
    },
    panel: {
        selector: '.monaco-workbench .part.panel',
        toggleCommandTitle: 'View: Toggle Panel Visibility',
    },
};

const VISIBILITY_SETTLE_TIMEOUT_MS = 2_000;

/**
 * Remembers the layout last requested for a given window so it can be
 * re-enforced just before a screenshot — VS Code chrome (notably the Copilot
 * Chat secondary side bar) can auto-pop *after* the pre-test layout pass, and
 * the window screenshot is captured at the end of the test.
 */
const appliedLayouts = new WeakMap<Page, WindowLayout>();

/**
 * Ensure a single part matches `desired` visibility. No-op when it already
 * does. Best-effort: a missing command or selector never fails the test.
 */
async function ensurePartVisibility(page: Page, part: PartDescriptor, desired: boolean): Promise<void> {
    const locator = page.locator(part.selector).first();

    let current: boolean;
    try {
        current = await locator.isVisible();
    } catch {
        // Selector lookup failed (workbench not ready / part absent) — skip.
        return;
    }

    if (current === desired) return;

    await runCommand(page, part.toggleCommandTitle);

    // Wait for the part to reach the desired state so callers (and the
    // subsequent screenshot) observe a settled layout. Best-effort: tolerate
    // the wait timing out rather than failing the test on a layout tweak.
    try {
        await locator.waitFor({
            state: desired ? 'visible' : 'hidden',
            timeout: VISIBILITY_SETTLE_TIMEOUT_MS,
        });
    } catch {
        /* The toggle was issued; don't fail a test on a layout settle wait. */
    }
}

/**
 * Apply a {@link WindowLayout} to the given VS Code window.
 *
 * Only keys present in `layout` are touched; `undefined` keys are left as-is.
 * Parts are processed one at a time (the command palette is a shared, modal
 * surface, so concurrent palette use would race).
 *
 * Safe to call repeatedly — it diffs against the live DOM and issues a toggle
 * only when needed, so re-applying the same layout is a no-op.
 *
 * @example
 *   // Inline, from within a test:
 *   await applyWindowLayout(vscodeWindow, { primarySideBar: false });
 */
export async function applyWindowLayout(page: Page, layout: WindowLayout): Promise<void> {
    if (page.isClosed()) return;

    appliedLayouts.set(page, { ...appliedLayouts.get(page), ...layout });

    for (const key of Object.keys(PARTS) as (keyof WindowLayout)[]) {
        const desired = layout[key];
        if (desired === undefined) continue;
        // Sequential by design — see the doc comment.
        // oxlint-disable-next-line no-await-in-loop
        await ensurePartVisibility(page, PARTS[key], desired);
    }
}
