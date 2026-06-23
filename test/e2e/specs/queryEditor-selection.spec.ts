/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import {
    captureNamedScreenshot,
    closeActiveEditorTab,
    closeAllEditorTabs,
    maximizeWindow,
} from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 5 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * table-row selection semantics and the row → document drill-in. These only
 * exist in edit mode, which the Query Editor enables for `SELECT *`-style
 * queries — so every test runs against the default `SELECT * FROM c`.
 *
 *  - single click selects exactly one row;
 *  - Ctrl/Cmd+click toggles a row in and out of the selection;
 *  - Shift+click selects a contiguous range from the anchor;
 *  - the View / Edit / Delete item buttons are disabled with no selection and
 *    enabled once a row is selected;
 *  - double-clicking a row opens that document in a separate Document webview.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/** The deterministic first product of the seed — present on the first page. */
const SEEDED_ID = 'prod-00000';

test.describe('queryEditor-selection', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        await maximizeWindow(vscodeApp);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
        // The default `SELECT * FROM c` puts the grid in edit mode so the
        // selection + drill-in affordances exist.
        await queryEditor.run();
        await queryEditor.waitForResults(SEEDED_ID);
        // Ensure rows have actually realized before any test interacts.
        await expect(queryEditor.tableRows().first()).toBeVisible();
    });

    test.afterEach(async ({ vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        queryEditor?.dispose();
        queryEditor = undefined;
        // Closes both the Query Editor and any Document tab a drill-in opened.
        await closeAllEditorTabs(vscodeWindow);
    });

    test('single click selects one row; Ctrl+click toggles add/remove', async () => {
        const qe = queryEditor!;

        // A plain click selects exactly the clicked row.
        await qe.selectRow(0);
        await expect.poll(() => qe.getSelectedRowCount()).toBe(1);

        // Ctrl+click on another row adds it to the selection.
        await qe.ctrlClickRow(2);
        await expect.poll(() => qe.getSelectedRowCount()).toBe(2);

        // Ctrl+click the same row again toggles it back out.
        await qe.ctrlClickRow(2);
        await expect.poll(() => qe.getSelectedRowCount()).toBe(1);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('Shift+click selects a contiguous range', async () => {
        const qe = queryEditor!;

        // Anchor on the first row, then Shift+click the fourth → rows 0..3.
        await qe.selectRow(0);
        await expect.poll(() => qe.getSelectedRowCount()).toBe(1);

        await qe.shiftClickRow(3);
        await expect.poll(() => qe.getSelectedRowCount()).toBe(4);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('View / Edit / Delete item buttons reflect the selection state', async () => {
        const qe = queryEditor!;

        // Nothing selected yet → all three selection-aware actions are disabled.
        await expect(qe.selectionActionButton('view')).toBeDisabled();
        await expect(qe.selectionActionButton('edit')).toBeDisabled();
        await expect(qe.selectionActionButton('delete')).toBeDisabled();

        // Selecting a row enables them.
        await qe.selectRow(0);
        await expect(qe.selectionActionButton('view')).toBeEnabled();
        await expect(qe.selectionActionButton('edit')).toBeEnabled();
        await expect(qe.selectionActionButton('delete')).toBeEnabled();

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('item hotkeys (Alt+V / Alt+E / Alt+I) open the Document panel', async ({ vscodeWindow }) => {
        const qe = queryEditor!;

        // These three result-panel hotkeys mirror the View / Edit / New item
        // buttons. focusResultPanel() before every press is essential: opening a
        // Document panel moves keyboard focus off the result grid, and Alt+E /
        // Alt+V would otherwise be swallowed by the host menu-bar mnemonics
        // (Edit / View) instead of the result-panel-scoped hotkey listener. Each
        // panel is closed before the next press so the (single) open Document
        // panel is unambiguous for waitForDocumentPanel.

        // View (Alt+V) → a read-only panel.
        await qe.focusResultPanel();
        await qe.selectRow(0);
        await qe.window.keyboard.press('Alt+V');
        let panel = await qe.waitForDocumentPanel();
        await expect(panel.getByText(/This item is read-only/)).toBeVisible();
        await closeActiveEditorTab(vscodeWindow);

        // Edit (Alt+E) → an editable panel.
        await qe.focusResultPanel();
        await qe.selectRow(0);
        await qe.window.keyboard.press('Alt+E');
        panel = await qe.waitForDocumentPanel();
        await expect(panel.getByText(/This item is editable/)).toBeVisible();
        await closeActiveEditorTab(vscodeWindow);

        // New (Alt+I): no selection required → an add-mode (editable) panel.
        // Left unsaved, so no document is created.
        await qe.focusResultPanel();
        await qe.window.keyboard.press('Alt+I');
        panel = await qe.waitForDocumentPanel();
        await expect(panel.getByText(/This item is editable/)).toBeVisible();

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('double-clicking a row opens it in a Document webview', async () => {
        const qe = queryEditor!;

        // Drill into the first row; the extension host opens a read-only
        // Document panel for that document.
        await qe.doubleClickRow(0);

        const documentFrame = await qe.waitForDocumentPanel();
        await expect(documentFrame.locator('#root')).toBeVisible();
        await expect(documentFrame.getByText(/This item is (read-only|editable)/)).toBeVisible();

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
