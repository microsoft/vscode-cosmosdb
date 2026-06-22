/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Page-object for the Query Editor webview (`QueryEditorTab`, viewType
 * `cosmosDbQuery`). Wraps the raw Playwright `Frame` with intention-revealing
 * actions so specs read as user stories rather than selector soup.
 *
 * This is the *minimal* Phase 0 surface (open / run / wait for results /
 * inspect rows) plus the console-health monitor that every Query Editor spec
 * shares. Later phases grow this object with toolbar, view-mode, paging,
 * selection and history helpers.
 *
 * Notes baked in from the existing emulator spec:
 *  - The Run control is a Fluent UI `SplitButton` whose visible label is
 *    "Run" — `getByRole('button', { name: 'Run', exact: true })` targets the
 *    primary action, not the history split arrow.
 *  - Result cells render inside a virtualized Fluent data grid, so text
 *    assertions poll `body.innerText` (mirrors `waitForFrameText` in
 *    `emulator-connected.spec.ts`) instead of one-shot `toContainText`.
 */

import { expect, type Frame, type Page } from '@playwright/test';
import { startConsoleHealth, type ConsoleHealth } from './consoleHealth';
import { captureNamedScreenshot } from './webviewHelpers';
import { openQueryEditor } from './webviews';

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Accessible names (English) of the query-toolbar controls. Buttons built via
 * `ToolbarOverflowButton` get a trailing period appended to their aria-label
 * (`ensureStopSymbol`), but Playwright's `name` option matches as a
 * case-insensitive substring, so the period-free names below match both the
 * toolbar button and its overflow-menu counterpart.
 */
export const QUERY_TOOLBAR = {
    run: 'Run',
    cancel: 'Cancel',
    open: 'Open',
    save: 'Save query',
    duplicate: 'Duplicate',
    learn: 'Learn more',
    schema: 'Schema',
    /** The connection picker is a Fluent `Dropdown` (role `combobox`). */
    connection: 'Connect to',
    /** Overflow menu trigger, present only when the toolbar is overflowing. */
    moreItems: 'More items',
} as const;

/** Role of a toolbar control's inline (un-collapsed) form. */
export type ToolbarControlRole = 'button' | 'combobox';

/**
 * Descriptor for a single query-toolbar control, capturing the two faces it can
 * present depending on the available width:
 *
 *   - inline in the `Toolbar` — located by `role` + accessible name `toolbarName`;
 *   - collapsed into the "More items" overflow menu — a `MenuItem` whose visible
 *     label is `menuText` (menu items expose different text/roles than their
 *     toolbar form — submenu triggers in particular are NOT matched by the
 *     `menuitem` role — so the menu side is matched by visible text).
 *
 * On a small display (e.g. a CI virtual screen) many controls start collapsed,
 * so specs must look for a control in the toolbar first and the overflow menu
 * second. The page-object helpers below (`expectControlReachable`,
 * `clickControl`, `openControlSubmenu`) do exactly that.
 */
export interface ToolbarControl {
    toolbarName: string;
    role: ToolbarControlRole;
    menuText: string;
    /** Match `toolbarName` exactly — needed for the `Run` SplitButton. */
    exact?: boolean;
}

/** Registry of the always-present query-toolbar controls. */
export const QUERY_CONTROLS = {
    run: { toolbarName: QUERY_TOOLBAR.run, role: 'button', menuText: 'Run', exact: true },
    cancel: { toolbarName: QUERY_TOOLBAR.cancel, role: 'button', menuText: 'Cancel' },
    open: { toolbarName: QUERY_TOOLBAR.open, role: 'button', menuText: 'Open' },
    save: { toolbarName: QUERY_TOOLBAR.save, role: 'button', menuText: 'Save' },
    duplicate: { toolbarName: QUERY_TOOLBAR.duplicate, role: 'button', menuText: 'Duplicate' },
    learn: { toolbarName: QUERY_TOOLBAR.learn, role: 'button', menuText: 'Learn' },
    schema: { toolbarName: QUERY_TOOLBAR.schema, role: 'button', menuText: 'Schema' },
    connection: { toolbarName: QUERY_TOOLBAR.connection, role: 'combobox', menuText: 'Connect to…' },
} as const satisfies Record<string, ToolbarControl>;

export class QueryEditorPage {
    private constructor(
        /** The Query Editor webview content frame. */
        public readonly frame: Frame,
        /** The VS Code main window page (for window-level modals etc.). */
        public readonly window: Page,
        /** Console-health monitor attached at mount time. */
        public readonly consoleHealth: ConsoleHealth,
    ) {}

    /**
     * Opens the Query Editor against the seeded emulator connection and starts
     * the console-health monitor. Resolves once the webview has rendered its
     * toolbar and editor (not merely mounted an empty `#root`).
     */
    static async open(window: Page): Promise<QueryEditorPage> {
        const frame = await openQueryEditor(window);
        const consoleHealth = startConsoleHealth(frame);
        await expect(frame.locator('#root')).toBeVisible();
        // Wait until the webview has actually painted its content — not just the
        // empty `#root` host — before snapshotting: the toolbar and its Run
        // button must be rendered and the Monaco editor mounted. This is the
        // "before" half of each test's screenshot pair (the "after" is taken in
        // the spec's afterEach).
        await expect(frame.getByRole('toolbar').first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
        await expect(frame.getByRole('button', { name: QUERY_TOOLBAR.run, exact: true })).toBeVisible({
            timeout: DEFAULT_TIMEOUT_MS,
        });
        await frame.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
        await captureNamedScreenshot(window, 'loaded');
        return new QueryEditorPage(frame, window, consoleHealth);
    }

    /**
     * Clicks the primary Run action on the default (or current) query. Does
     * not wait for results — call {@link waitForResults} / {@link expectRow}.
     */
    async run(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
        await this.frame.getByRole('button', { name: 'Run', exact: true }).click({ timeout: timeoutMs });
    }

    /**
     * Waits until a known seeded row id is visible in the results, proving the
     * query round-tripped to the emulator and rendered. Defaults to
     * `prod-00000` — the deterministic first product of the seed.
     */
    async waitForResults(needle: string = 'prod-00000', timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
        await this.waitForFrameText(needle, timeoutMs);
    }

    /** Asserts that `text` appears somewhere in the result frame body. */
    async expectRow(text: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
        await this.waitForFrameText(text, timeoutMs);
    }

    /**
     * Best-effort count of rendered data-grid rows (excluding the header row).
     * The grid is virtualized, so this reflects what is currently realized in
     * the DOM, not the total page size — use it for relative assertions only.
     */
    async getResultRowCount(): Promise<number> {
        const total = await this.frame.locator('[role="row"]').count();
        // Subtract the header row when present.
        const headers = await this.frame.locator('[role="row"] [role="columnheader"]').count();
        return headers > 0 ? Math.max(0, total - 1) : total;
    }

    /** Detaches the console-health listener. Call from `afterEach`. */
    dispose(): void {
        this.consoleHealth.dispose();
    }

    // ─── Query toolbar ────────────────────────────────────────────────────

    /**
     * Waits until the toolbar reflects a live connection — the Run button is
     * enabled only once `state.isConnected` is true.
     */
    async waitForConnected(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
        await expect(this.frame.getByRole('button', { name: QUERY_TOOLBAR.run, exact: true })).toBeEnabled({
            timeout: timeoutMs,
        });
    }

    /** True when the toolbar collapsed some items into the "More items" menu. */
    async isOverflowing(): Promise<boolean> {
        const more = this.frame.getByRole('button', { name: QUERY_TOOLBAR.moreItems });
        return (
            (await more.count()) > 0 &&
            (await more
                .first()
                .isVisible()
                .catch(() => false))
        );
    }

    /** Locator for the Fluent toolbar element (excludes the overflow popover). */
    toolbar() {
        return this.frame.getByRole('toolbar').first();
    }

    /**
     * Waits until the toolbar's overflow state matches `shouldOverflow`. When
     * the toolbar is not overflowing the `OverflowMenu` renders nothing, so the
     * "More items" trigger is absent (count 0); when it is, the trigger is
     * visible.
     */
    async waitForOverflowState(shouldOverflow: boolean, timeoutMs: number = 10_000): Promise<void> {
        const more = this.frame.getByRole('button', { name: QUERY_TOOLBAR.moreItems });
        if (shouldOverflow) {
            await expect(more.first()).toBeVisible({ timeout: timeoutMs });
        } else {
            await expect(more).toHaveCount(0, { timeout: timeoutMs });
        }
    }

    /** Opens the overflow menu if present. Returns false when not overflowing. */
    async openOverflowMenu(): Promise<boolean> {
        if (!(await this.isOverflowing())) {
            return false;
        }
        const more = this.frame.getByRole('button', { name: QUERY_TOOLBAR.moreItems }).first();
        const menu = this.frame.getByRole('menu').first();
        // The Fluent menu trigger occasionally swallows the first click (the
        // toolbar is still settling its overflow layout right after a resize),
        // so retry — but bail out early if a click already opened the menu, to
        // avoid a second click toggling it back closed.
        for (let attempt = 0; attempt < 3; attempt++) {
            if (await menu.isVisible().catch(() => false)) {
                return true;
            }
            await more.click();
            try {
                await menu.waitFor({ state: 'visible', timeout: 2_000 });
                return true;
            } catch {
                // Menu didn't open this attempt — loop and try again.
            }
        }
        await menu.waitFor({ state: 'visible', timeout: 3_000 });
        return true;
    }

    /** Dismisses any open Fluent menu / dropdown by pressing Escape. */
    async dismissMenus(): Promise<void> {
        await this.frame.locator('body').press('Escape');
    }

    /**
     * Reports whether a toolbar control is reachable — either visible directly
     * in the toolbar or available inside the overflow menu. Leaves the toolbar
     * in its resting state (closes the overflow menu if it had to open it).
     */
    async expectControlReachable(control: ToolbarControl): Promise<void> {
        if (await this.isControlInline(control)) {
            return;
        }
        const opened = await this.openOverflowMenu();
        expect(opened, `Control "${control.toolbarName}" is neither inline nor in an overflow menu.`).toBe(true);
        await expect(this.overflowMenu()).toContainText(control.menuText);
        await this.dismissMenus();
    }

    /**
     * Locator for a control's inline (toolbar) form. Scoped to the toolbar so it
     * never matches the same control's overflow-menu counterpart.
     */
    inlineControl(control: ToolbarControl) {
        return this.toolbar()
            .getByRole(control.role, { name: control.toolbarName, exact: control.exact ?? false })
            .first();
    }

    /** True when the control is currently shown inline in the toolbar. */
    async isControlInline(control: ToolbarControl): Promise<boolean> {
        return this.inlineControl(control)
            .isVisible()
            .catch(() => false);
    }

    /** Locator for the open overflow popover menu (its top-level list). */
    overflowMenu() {
        return this.frame.getByRole('menu').first();
    }

    /**
     * Clicks/activates a control, routing through the overflow menu when the
     * control has collapsed into it (looks in the toolbar first, the overflow
     * menu second). For plain action buttons (Open / Save / Duplicate) this
     * fires the action; for menu-trigger controls (Learn / Schema) it opens
     * their menu — use {@link openControlSubmenu} when you need to await it.
     */
    async clickControl(control: ToolbarControl): Promise<void> {
        if (await this.isControlInline(control)) {
            await this.inlineControl(control).click();
            return;
        }
        if (!(await this.openOverflowMenu())) {
            throw new Error(`Control "${control.toolbarName}" is neither inline nor available in the overflow menu.`);
        }
        await this.overflowMenu().getByText(control.menuText, { exact: true }).first().click();
    }

    /**
     * Opens a menu-trigger control's popover (Learn / Schema) and resolves once
     * the submenu is visible. Works whether the trigger is inline or collapsed
     * into the overflow menu. Caller should {@link dismissMenus} afterwards.
     */
    async openControlSubmenu(control: ToolbarControl): Promise<void> {
        await this.clickControl(control);
        await this.frame.getByRole('menu').last().waitFor({ state: 'visible', timeout: 5_000 });
    }

    /** Locator for the connection picker combobox (inline form). */
    connectionPicker() {
        return this.frame.getByRole('combobox', { name: QUERY_TOOLBAR.connection });
    }

    /**
     * Runs the current query via the keyboard. The `queryEditor` hotkey scope
     * is bound to the editor subtree, so focus must be inside Monaco first.
     * `ExecuteQuery` is bound to F5 (Monaco leaves F5 unhandled, so it reaches
     * the app's document-level hotkey listener; Shift+Enter is swallowed by the
     * editor as a newline).
     */
    async runViaHotkey(): Promise<void> {
        await this.frame.locator('.monaco-editor').first().click();
        await this.frame.locator('textarea.inputarea').first().waitFor({ state: 'attached', timeout: 5_000 });
        await this.window.keyboard.press('F5');
    }

    /**
     * Polls the frame body's innerText for `needle` until the deadline. Mirrors
     * the proven `waitForFrameText` loop in `emulator-connected.spec.ts` to
     * sidestep data-grid virtualization races.
     */
    private async waitForFrameText(needle: string, timeoutMs: number): Promise<void> {
        const deadline = Date.now() + timeoutMs;
        let lastSnapshot = '';
        // Sequential by design — this is a "wait until ready" probe.
        while (Date.now() < deadline) {
            try {
                lastSnapshot = await this.frame.locator('body').innerText({ timeout: 1_000 });
                if (lastSnapshot.includes(needle)) {
                    return;
                }
            } catch {
                // Frame may navigate during load — retry.
            }
            // oxlint-disable-next-line no-await-in-loop
            await new Promise((r) => setTimeout(r, 250));
        }

        throw new Error(
            `Result frame did not contain "${needle}" within ${timeoutMs} ms. ` +
                `Last snapshot (first 600 chars): ${lastSnapshot.slice(0, 600)}`,
        );
    }
}
