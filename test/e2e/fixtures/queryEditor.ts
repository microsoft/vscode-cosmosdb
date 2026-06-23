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
import { captureNamedScreenshot, getWebviewByPredicate } from './webviewHelpers';
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

/** The three result renderers the "Change view mode" dropdown switches between. */
export type ResultViewMode = 'Tree' | 'JSON' | 'Table';

/**
 * Names attached to the result-panel "Change view mode" dropdown
 * (`ChangeViewModeDropdown.tsx`):
 *
 *  - `dropdown` — the combobox's accessible name (a Fluent `Tooltip` with
 *    `relationship="label"` supplies it as the `aria-label`);
 *  - `options` — the visible label of each `Option` in the open listbox
 *    (note the trailing "view": `Tree view` / `JSON view` / `Table view`);
 *  - `valueText` — the short label the closed dropdown shows for the active
 *    mode (`Tree` / `JSON` / `Table`), used by {@link QueryEditorPage.getActiveViewMode}.
 */
export const RESULT_VIEW = {
    dropdown: 'Change view mode',
    options: { Tree: 'Tree view', JSON: 'JSON view', Table: 'Table view' },
    valueText: { Tree: 'Tree', JSON: 'JSON', Table: 'Table' },
} as const satisfies {
    dropdown: string;
    options: Record<ResultViewMode, string>;
    valueText: Record<ResultViewMode, string>;
};

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

/**
 * Registry of the result-panel toolbar controls (`ResultPanelToolbarOverflow`).
 * Same two-faced shape as {@link QUERY_CONTROLS}: an inline toolbar button
 * (matched by its aria-label substring) or a collapsed overflow-menu entry
 * (matched by visible text). The result toolbar shares the `Default` aria-label
 * with the query toolbar, so the page-object scopes these lookups to the
 * "Result Panel" region.
 *
 * Note: `copy` and `export` are split menus — activating either (inline button
 * or overflow entry) opens a CSV/JSON submenu; pick the format afterwards.
 */
export const RESULT_CONTROLS = {
    reload: { toolbarName: 'Reload query results', role: 'button', menuText: 'Refresh' },
    firstPage: { toolbarName: 'Go to first page', role: 'button', menuText: 'Go to first page' },
    prevPage: { toolbarName: 'Go to previous page', role: 'button', menuText: 'Go to previous page' },
    nextPage: { toolbarName: 'Go to next page', role: 'button', menuText: 'Go to next page' },
    copy: { toolbarName: 'Copy', role: 'button', menuText: 'Copy to clipboard' },
    export: { toolbarName: 'Export', role: 'button', menuText: 'Export' },
} as const satisfies Record<string, ToolbarControl>;

/** Clipboard / file export formats offered by the Copy and Export split menus. */
export type ExportFormat = 'CSV' | 'JSON';

/**
 * Accessible-name substrings of the selection-aware item buttons in the
 * result tab toolbar (`ResultTabToolbar`). They only render in edit mode (a
 * `SELECT *`-style query) and are enabled only while at least one row is
 * selected. Substring matching tolerates the trailing period
 * (`ensureStopSymbol`) and the `(s)` plural on Delete.
 */
export const SELECTION_ACTIONS = {
    view: 'View selected item',
    edit: 'Edit selected item',
    delete: 'Delete selected item',
} as const;

/** A selection-aware item action whose enablement tracks the row selection. */
export type SelectionAction = keyof typeof SELECTION_ACTIONS;

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
     * Attaches to a Query Editor webview that some *other* affordance already
     * opened — e.g. the production "Open Query Editor" tree action exercised by
     * the tree-open spec — rather than opening one via the e2e command. Finds
     * the content frame by its rendered Run button (so it never matches another
     * panel's frame) and starts the console-health monitor.
     */
    static async fromOpenTab(window: Page): Promise<QueryEditorPage> {
        const frame = await getWebviewByPredicate(
            window,
            async (candidate) =>
                (await candidate.getByRole('button', { name: QUERY_TOOLBAR.run, exact: true }).count()) > 0,
        );
        const consoleHealth = startConsoleHealth(frame);
        await expect(frame.locator('#root')).toBeVisible();
        await expect(frame.getByRole('toolbar').first()).toBeVisible({ timeout: DEFAULT_TIMEOUT_MS });
        await expect(frame.getByRole('button', { name: QUERY_TOOLBAR.run, exact: true })).toBeVisible({
            timeout: DEFAULT_TIMEOUT_MS,
        });
        await frame.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
        await captureNamedScreenshot(window, 'loaded');
        return new QueryEditorPage(frame, window, consoleHealth);
    }

    /**
     * Attaches to a Query Editor webview *other than* `exclude` — the second
     * tab that {@link duplicateTab} spawns. Finds a content frame that is not
     * the excluded one, renders the Run button, and has its Monaco editor
     * mounted, then starts a fresh console-health monitor for it. Caller owns
     * the returned page-object and should {@link dispose} it.
     */
    static async attachOther(window: Page, exclude: Frame): Promise<QueryEditorPage> {
        const frame = await getWebviewByPredicate(window, async (candidate) => {
            if (candidate === exclude) {
                return false;
            }
            return (await candidate.getByRole('button', { name: QUERY_TOOLBAR.run, exact: true }).count()) > 0;
        });
        const consoleHealth = startConsoleHealth(frame);
        await expect(frame.locator('#root')).toBeVisible();
        await frame.locator('.monaco-editor').first().waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
        return new QueryEditorPage(frame, window, consoleHealth);
    }
    async run(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
        await this.frame.getByRole('button', { name: 'Run', exact: true }).click({ timeout: timeoutMs });
    }

    /**
     * Activates the "Duplicate" toolbar control, which opens a second Query
     * Editor tab seeded with the current editor text (routing through the
     * overflow menu when the toolbar has collapsed it). Use
     * {@link QueryEditorPage.attachOther} to drive the resulting tab.
     */
    async duplicateTab(): Promise<void> {
        await this.clickControl(QUERY_CONTROLS.duplicate);
    }

    /** The query toolbar's Run split-button (primary action). */
    runButton() {
        return this.toolbar().getByRole('button', { name: 'Run', exact: true });
    }

    /**
     * The query toolbar's Cancel button. It is disabled at rest and enabled only
     * while a query is executing (`state.isExecuting`), so it doubles as an
     * observable "a query is in flight" signal.
     */
    cancelButton() {
        return this.toolbar().getByRole('button', { name: QUERY_TOOLBAR.cancel });
    }

    /** Clicks the Cancel button to abort the in-flight query. */
    async cancelQuery(): Promise<void> {
        await this.cancelButton().click();
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

    // ─── Run history ──────────────────────────────────────────────────────

    /**
     * The Run split-button's history menu trigger (the dropdown arrow next to
     * the primary "Run" action). Its accessible name is "Show history of
     * previous queries" (`RunQueryButton.tsx`). On a wide window it stays inline
     * in the query toolbar; the history specs maximize to keep it there.
     */
    runHistoryTrigger() {
        return this.frame.getByRole('button', { name: 'Show history of previous queries' });
    }

    /**
     * Opens the Run split-button history menu and waits for it to render. The
     * Fluent popover here does not expose a `role="menu"` container, so this
     * waits on the first `menuitem` instead.
     */
    async openRunHistoryMenu(): Promise<void> {
        const trigger = this.runHistoryTrigger().first();
        const anyItem = this.frame.getByRole('menuitem').first();
        // The Fluent SplitButton menu trigger occasionally swallows the first
        // click, so retry — but bail out early once an item is visible to avoid
        // a second click toggling it shut (mirrors {@link openOverflowMenu}).
        for (let attempt = 0; attempt < 3; attempt++) {
            if (await anyItem.isVisible().catch(() => false)) {
                return;
            }
            await trigger.click();
            try {
                await anyItem.waitFor({ state: 'visible', timeout: 2_000 });
                return;
            } catch {
                // Menu didn't open this attempt — loop and try again.
            }
        }
        await anyItem.waitFor({ state: 'visible', timeout: 3_000 });
    }

    /**
     * Visible text of every entry in the open Run history menu. Includes the
     * disabled "No history" placeholder when the history is empty, plus any
     * configuration submenu triggers (Throughput Bucket / Priority Level) when
     * the connection exposes them — neither appears on the emulator.
     */
    async getHistoryEntries(): Promise<string[]> {
        return this.frame.getByRole('menuitem').allInnerTexts();
    }

    /**
     * Reads the current Monaco editor text (the rendered query buffer). Monaco
     * renders inter-token gaps as non-breaking spaces, so they are normalized
     * back to regular spaces for stable substring assertions.
     */
    async getQueryText(): Promise<string> {
        const rendered = await this.frame.locator('.monaco-editor .view-lines').first().innerText();
        return rendered.replace(/\u00a0/g, ' ').trim();
    }

    // ─── Result view modes (Tree / JSON / Table) ──────────────────────────

    /**
     * Locator for the result-panel "Change view mode" dropdown (a Fluent
     * `Dropdown`, role `combobox`). It lives in the result toolbar and is
     * present whenever a result tab is shown.
     */
    viewModeDropdown() {
        return this.frame.getByRole('combobox', { name: RESULT_VIEW.dropdown });
    }

    /**
     * Reads the currently active result view mode from the dropdown's value.
     * The closed dropdown shows the short label (`Tree` / `JSON` / `Table`).
     */
    async getActiveViewMode(): Promise<ResultViewMode> {
        const text = (await this.viewModeDropdown().innerText()).trim();
        if (text.includes(RESULT_VIEW.valueText.Tree)) {
            return 'Tree';
        }
        if (text.includes(RESULT_VIEW.valueText.JSON)) {
            return 'JSON';
        }
        return 'Table';
    }

    /**
     * Locator for the renderer that backs a given view mode. Used to assert the
     * correct view is actually mounted (not merely selected in the dropdown):
     *  - Table / Tree are `react-data-grid`s exposing role `grid` with a
     *    distinct accessible name;
     *  - JSON is a read-only Monaco editor inside the results display area.
     */
    activeViewContainer(mode: ResultViewMode) {
        switch (mode) {
            case 'Table':
                return this.frame.getByRole('grid', { name: 'Query results table' });
            case 'Tree':
                return this.frame.getByRole('grid', { name: 'Query results tree' });
            case 'JSON':
                return this.frame.locator('.resultsDisplayArea .monaco-editor').first();
        }
    }

    /**
     * Switches the result view via the "Change view mode" dropdown and waits
     * until the target renderer has mounted. Switching triggers an async
     * recalculation (brief spinner) before the new view paints.
     */
    async setViewMode(mode: ResultViewMode, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<void> {
        await this.viewModeDropdown().click();
        await this.frame.getByRole('option', { name: RESULT_VIEW.options[mode], exact: true }).click();
        await this.activeViewContainer(mode).waitFor({ state: 'visible', timeout: timeoutMs });
    }

    // ─── Table selection + drill-in (edit-mode `SELECT *` results) ─────────

    /** The active Table-view data grid (react-data-grid). */
    private tableGrid() {
        return this.frame.getByRole('grid', { name: 'Query results table' });
    }

    /** Data rows of the Table view (excludes the header row). */
    tableRows() {
        return this.tableGrid().locator('.rdg-row');
    }

    /** The first data cell of the 0-based table row `index` — the click target. */
    private tableRowCell(index: number) {
        return this.tableRows().nth(index).locator('.rdg-cell').first();
    }

    /** Count of currently selected (highlighted) table rows. */
    async getSelectedRowCount(): Promise<number> {
        return this.tableGrid().locator(".rdg-row[aria-selected='true']").count();
    }

    /** Plain click: selects only row `index` (clears any prior selection). */
    async selectRow(index: number): Promise<void> {
        await this.tableRowCell(index).click();
    }

    /** Ctrl/Cmd+click: toggles row `index` in/out of the current selection. */
    async ctrlClickRow(index: number): Promise<void> {
        await this.tableRowCell(index).click({ modifiers: ['ControlOrMeta'] });
    }

    /** Shift+click: extends the selection from the anchor row to `index`. */
    async shiftClickRow(index: number): Promise<void> {
        await this.tableRowCell(index).click({ modifiers: ['Shift'] });
    }

    /** Double-click: drills into row `index`, opening its Document webview. */
    async doubleClickRow(index: number): Promise<void> {
        await this.tableRowCell(index).dblclick();
    }

    // ─── Column resize (Table-view header menu → Resize dialog) ────────────

    /** The Table-view column header cell for the column named `name`. */
    columnHeader(name: string) {
        return this.tableGrid().getByRole('columnheader', { name, exact: false });
    }

    /** Current on-screen width (px) of the named Table-view column header. */
    async columnWidth(name: string): Promise<number> {
        const box = await this.columnHeader(name).boundingBox();
        return box?.width ?? 0;
    }

    /**
     * Opens the named Table-view column's "Resize" dialog: hovers the header,
     * opens the chevron context menu (its button is `aria-hidden` until opened,
     * so it is targeted by DOM rather than role) and picks "Resize". Returns the
     * dialog locator so callers can apply or cancel.
     */
    async openColumnResizeDialog(name: string) {
        const header = this.columnHeader(name);
        await header.scrollIntoViewIfNeeded();
        await header.hover();
        await header.locator('button').first().click();
        await this.frame.getByRole('menuitem', { name: 'Resize.', exact: false }).click();
        const dialog = this.frame.getByRole('dialog');
        await dialog.getByText('Resize Column').waitFor({ state: 'visible', timeout: 5_000 });
        return dialog;
    }

    /**
     * Sets an explicit width on the named Table-view column via its header menu:
     * opens the Resize dialog, types `width` into the "Column Width (px)" field
     * and applies. The grid re-lays out synchronously once the dialog closes.
     */
    async resizeColumn(name: string, width: number): Promise<void> {
        const dialog = await this.openColumnResizeDialog(name);
        await dialog.locator('#column-width').fill(String(width));
        await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
        await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    }

    /**
     * Opens the named column's Resize dialog, types `width`, then dismisses it
     * with Cancel — used to prove a cancelled resize leaves the column untouched.
     */
    async cancelColumnResize(name: string, width: number): Promise<void> {
        const dialog = await this.openColumnResizeDialog(name);
        await dialog.locator('#column-width').fill(String(width));
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
        await dialog.waitFor({ state: 'hidden', timeout: 5_000 });
    }

    /** Locator for a selection-aware item button (View / Edit / Delete). */
    selectionActionButton(action: SelectionAction) {
        return this.resultRegion().getByRole('button', { name: SELECTION_ACTIONS[action] });
    }

    /** The "Add new item" button — present in edit mode regardless of selection. */
    newItemButton() {
        return this.resultRegion().getByRole('button', { name: 'Add new item' });
    }

    /** Clicks "Add new item", which opens a Document webview in 'add' mode. */
    async addNewItem(): Promise<void> {
        await this.newItemButton().click();
    }

    /** Selects row `index` then invokes its View/Edit/Delete item action. */
    async invokeSelectionAction(index: number, action: SelectionAction): Promise<void> {
        await this.selectRow(index);
        await expect(this.selectionActionButton(action)).toBeEnabled();
        await this.selectionActionButton(action).click();
    }

    /**
     * Waits for the Document webview opened by a row drill-in (double-click or
     * the View / Edit item buttons) to mount, returning its content frame. The
     * Document panel is identified by its read-only / editable banner, which the
     * Query Editor frame never renders, so the predicate also skips this page's
     * own frame.
     */
    async waitForDocumentPanel(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Frame> {
        return getWebviewByPredicate(
            this.window,
            async (frame) => {
                if (frame === this.frame) {
                    return false;
                }
                return (await frame.getByText(/This item is (read-only|editable)/).count()) > 0;
            },
            timeoutMs,
        );
    }

    // ─── Editor text ──────────────────────────────────────────────────────

    /**
     * Replaces the Monaco query text. Focuses the editor, selects all, and
     * types the new query. The caller still triggers execution ({@link run} /
     * {@link runViaHotkey}); typing alone does not run anything.
     */
    async setQueryText(text: string): Promise<void> {
        await this.frame.locator('.monaco-editor').first().click();
        await this.frame.locator('textarea.inputarea').first().waitFor({ state: 'attached', timeout: 5_000 });
        await this.window.keyboard.press('Control+A');
        await this.window.keyboard.press('Delete');
        await this.window.keyboard.type(text);
    }

    /**
     * Selects the whole of (0-based) editor line `lineIndex`, leaving it as the
     * active selection. The Query Editor tracks the Monaco selection into
     * `querySelectedValue`, and Run executes that selection in preference to the
     * full editor text — so this drives the "run only the selected fragment"
     * path. Navigates by keyboard (Ctrl+Home + ArrowDown) to avoid fragile
     * per-line click coordinates; the first `Home` lands on the first
     * non-whitespace column, so any auto-indent is excluded from the selection.
     */
    async selectQueryLine(lineIndex: number): Promise<void> {
        await this.frame.locator('.monaco-editor').first().click();
        await this.frame.locator('textarea.inputarea').first().waitFor({ state: 'attached', timeout: 5_000 });
        await this.window.keyboard.press('Control+Home');
        for (let i = 0; i < lineIndex; i++) {
            await this.window.keyboard.press('ArrowDown');
        }
        await this.window.keyboard.press('Home');
        await this.window.keyboard.press('Shift+End');
        // Let the selection-change event flush into querySelectedValue before the
        // caller triggers Run.
        await this.window.waitForTimeout(200);
    }

    // ─── Result toolbar (reload / paging / copy / export) ─────────────────

    /** The Result Panel `section` (role `region`), scoping result-side lookups. */
    resultRegion() {
        return this.frame.getByRole('region', { name: 'Result Panel' });
    }

    /**
     * The result-panel toolbar. Both the query and result toolbars expose the
     * `Default` accessible name, so this is scoped to the Result Panel region to
     * disambiguate from the query toolbar.
     */
    resultToolbar() {
        return this.resultRegion().getByRole('toolbar', { name: 'Default' });
    }

    /** Inline (toolbar) locator for a result control, scoped to the region. */
    inlineResultControl(control: ToolbarControl) {
        return this.resultToolbar()
            .getByRole(control.role, { name: control.toolbarName, exact: control.exact ?? false })
            .first();
    }

    /**
     * Opens the result toolbar's "More items" overflow menu if it is present.
     * Toggle-safe (mirrors {@link openOverflowMenu}); returns false when the
     * result toolbar is not overflowing.
     */
    async openResultOverflowMenu(): Promise<boolean> {
        const more = this.resultToolbar().getByRole('button', { name: QUERY_TOOLBAR.moreItems });
        if (
            (await more.count()) === 0 ||
            !(await more
                .first()
                .isVisible()
                .catch(() => false))
        ) {
            return false;
        }
        const menu = this.frame.getByRole('menu').first();
        for (let attempt = 0; attempt < 3; attempt++) {
            if (await menu.isVisible().catch(() => false)) {
                return true;
            }
            await more.first().click();
            try {
                await menu.waitFor({ state: 'visible', timeout: 2_000 });
                return true;
            } catch {
                // Menu didn't open this attempt — retry.
            }
        }
        await menu.waitFor({ state: 'visible', timeout: 3_000 });
        return true;
    }

    /**
     * Activates a result control, looking in the toolbar first and the overflow
     * menu second. For plain action buttons (Reload / paging) this fires the
     * action; for the split menus (Copy / Export) it opens their submenu — use
     * {@link copyResults} / {@link exportResults} for those.
     */
    async clickResultControl(control: ToolbarControl): Promise<void> {
        const inline = this.inlineResultControl(control);
        if (await inline.isVisible().catch(() => false)) {
            await inline.click();
            return;
        }
        if (!(await this.openResultOverflowMenu())) {
            throw new Error(`Result control "${control.toolbarName}" is neither inline nor in the overflow menu.`);
        }
        await this.frame.getByRole('menu').first().getByText(control.menuText, { exact: true }).first().click();
    }

    /** Re-runs the current query via the Reload button. */
    async reloadResults(): Promise<void> {
        await this.clickResultControl(RESULT_CONTROLS.reload);
    }

    /** Navigates result pages (disabled controls are simply no-ops in the UI). */
    async goToNextPage(): Promise<void> {
        await this.clickResultControl(RESULT_CONTROLS.nextPage);
    }
    async goToPrevPage(): Promise<void> {
        await this.clickResultControl(RESULT_CONTROLS.prevPage);
    }
    async goToFirstPage(): Promise<void> {
        await this.clickResultControl(RESULT_CONTROLS.firstPage);
    }

    /**
     * Reads the status-bar record range (e.g. `0 - 10`) shown in the result
     * toolbar for the current page. Polls because it briefly shows a timer
     * while a query is executing.
     */
    async getStatusRange(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string> {
        const range = this.resultToolbar()
            .getByText(/^\d+\s*-\s*\d+$/)
            .first();
        await range.waitFor({ state: 'visible', timeout: timeoutMs });
        return (await range.innerText()).trim();
    }

    /**
     * Opens the Copy split menu (toolbar or overflow) and picks a format,
     * copying the current page / selection to the clipboard.
     */
    async copyResults(format: ExportFormat = 'JSON'): Promise<void> {
        await this.openResultSplitMenu(RESULT_CONTROLS.copy);
        await this.frame.getByRole('menuitem', { name: format, exact: true }).first().click();
    }

    /**
     * Opens the Export split menu (toolbar or overflow) and picks a format. The
     * underlying save dialog is stubbed by the fixture, so this is a safe no-op
     * that only proves the action wires up without error.
     */
    async exportResults(format: ExportFormat = 'JSON'): Promise<void> {
        await this.openResultSplitMenu(RESULT_CONTROLS.export);
        await this.frame.getByRole('menuitem', { name: format, exact: true }).first().click();
    }

    /** Opens a Copy/Export split menu so its CSV/JSON items become available. */
    private async openResultSplitMenu(control: ToolbarControl): Promise<void> {
        const inline = this.inlineResultControl(control);
        if (await inline.isVisible().catch(() => false)) {
            await inline.click();
            return;
        }
        if (!(await this.openResultOverflowMenu())) {
            throw new Error(`Result control "${control.toolbarName}" is neither inline nor in the overflow menu.`);
        }
        await this.frame.getByRole('menu').first().getByText(control.menuText, { exact: true }).first().click();
    }

    // ─── Result tabs (Result / Stats) ─────────────────────────────────────

    /** Switches to the Stats tab (query metrics + index metrics). */
    async switchToStatsTab(): Promise<void> {
        await this.resultRegion().getByRole('tab', { name: 'Stats' }).click();
    }

    /** Switches back to the Result tab (the data views). */
    async switchToResultTab(): Promise<void> {
        await this.resultRegion().getByRole('tab', { name: 'Result' }).click();
    }

    /** Locator for the named result tab (`Result` / `Stats`). */
    resultTab(name: 'Result' | 'Stats') {
        return this.resultRegion().getByRole('tab', { name, exact: true });
    }

    /** True when the named result tab is the currently selected one. */
    async isResultTabSelected(name: 'Result' | 'Stats'): Promise<boolean> {
        return (await this.resultTab(name).getAttribute('aria-selected')) === 'true';
    }

    /**
     * Moves keyboard focus into the result panel (without selecting a data row)
     * so the webview's document-level hotkey listeners receive subsequent
     * keystrokes. Clicks the result tablist, which is a focusable, side-effect
     * free target.
     */
    async focusResultPanel(): Promise<void> {
        // Closing a Document panel just before this call can briefly tear down
        // and re-render the result webview, surfacing a transient "context
        // destroyed"/"target closed" error on the click. Retry until the
        // tablist is clickable so the focus action rides through that churn.
        const tablist = this.resultRegion().getByRole('tablist').first();
        await expect(async () => {
            await tablist.click({ timeout: 2_000 });
        }).toPass({ timeout: 15_000 });
    }

    /**
     * True once the Stats tab's query-metrics panel is populated. Anchored on
     * the panel's "Learn more about query metrics" link, whose accessible name
     * is stable regardless of which metrics the backend returned.
     */
    async hasQueryMetrics(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<boolean> {
        return this.resultRegion()
            .getByRole('link', { name: 'Learn more about query metrics' })
            .first()
            .isVisible({ timeout: timeoutMs })
            .catch(() => false);
    }

    /**
     * True when the Stats tab's index-metrics panel is rendered. The panel only
     * appears when the query result carried a non-empty `indexMetrics` payload.
     * Anchored on its "Learn more about index metrics" link.
     */
    async hasIndexMetrics(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<boolean> {
        return this.resultRegion()
            .getByRole('link', { name: 'Learn more about index metrics' })
            .first()
            .isVisible({ timeout: timeoutMs })
            .catch(() => false);
    }

    // ─── Page size (incl. the re-run confirmation modal) ──────────────────

    /** The page-size dropdown (Fluent combobox) in the result toolbar. */
    pageSizeDropdown() {
        return this.resultRegion().getByRole('combobox', { name: 'Change page size' });
    }

    /** Reads the current page-size value shown by the dropdown (e.g. `10`, `All`). */
    async getPageSizeValue(): Promise<string> {
        return (await this.pageSizeDropdown().first().innerText()).trim();
    }

    /**
     * Selects a page size via the dropdown. `size` is the option label (`10`,
     * `50`, `100`, `500`, or `All`). Does NOT handle the re-run confirmation
     * modal that the backend raises when a query has already executed — drive
     * it via {@link confirmPageSizeModal} / {@link dismissPageSizeModal}.
     */
    async setPageSize(size: '10' | '50' | '100' | '500' | 'All'): Promise<void> {
        const dropdown = this.pageSizeDropdown().first();
        if (await dropdown.isVisible().catch(() => false)) {
            await dropdown.click();
        } else {
            // Collapsed: open the result overflow menu, then the "Change page
            // size" submenu, before picking the value.
            if (!(await this.openResultOverflowMenu())) {
                throw new Error('Page-size control is neither inline nor in the overflow menu.');
            }
            await this.frame.getByRole('menu').first().getByText('Change page size', { exact: true }).first().click();
        }
        await this.frame.getByRole('option', { name: size, exact: true }).first().click();
    }

    /**
     * Best-effort check that no native page-size confirmation modal is pending.
     * The confirmation is a native Electron dialog (auto-resolved by the test
     * dialog stub), so there is no in-DOM modal to assert against — this simply
     * confirms no stray workbench dialog leaked onto the main window.
     */
    pageSizeModal() {
        return this.window.locator('.monaco-dialog-box');
    }

    /**
     * Runs the current query via the keyboard. The `queryEditor` hotkey scope
     * is bound to the editor subtree, so focus must be inside Monaco first.
     * `ExecuteQuery` is bound to F5 (Monaco leaves F5 unhandled, so it reaches
     * the app's document-level hotkey listener; Shift+Enter is swallowed by the
     * editor as a newline).
     */
    async runViaHotkey(): Promise<void> {
        await this.focusEditor();
        await this.window.keyboard.press('F5');
    }

    /**
     * Moves keyboard focus into the Monaco editor so the `queryEditor`-scoped
     * hotkeys (ExecuteQuery, SaveToDisk, OpenQuery, Cancel) reach the webview's
     * document-level listener bound to the QueryPanel subtree.
     */
    async focusEditor(): Promise<void> {
        await this.frame.locator('.monaco-editor').first().click();
        await this.frame.locator('textarea.inputarea').first().waitFor({ state: 'attached', timeout: 5_000 });
    }

    /** Focuses the editor, then presses an editor-scoped hotkey (e.g. `Control+O`). */
    async pressEditorHotkey(key: string): Promise<void> {
        await this.focusEditor();
        await this.window.keyboard.press(key);
    }

    /**
     * Focuses the result panel, then presses a `resultPanel`-scoped hotkey
     * (paging, Refresh, Copy, Export). Focus lands on the result tablist, which
     * is inside the ResultPanel subtree the scope is bound to.
     */
    async pressResultHotkey(key: string): Promise<void> {
        await this.focusResultPanel();
        await this.window.keyboard.press(key);
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
