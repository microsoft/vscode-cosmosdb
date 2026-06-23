/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 13 of the Query Editor e2e coverage: the per-column "Resize" dialog.
 *
 * Each Table-view column header carries a chevron context menu whose "Resize"
 * entry opens the `ColumnResizeDialog` — a Fluent dialog with a numeric
 * "Column Width (px)" field and Apply / Cancel actions. Applying a value pins
 * the column to that width; cancelling leaves it untouched.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/** A `SELECT *` query so the result renders as an edit-mode Table with columns. */
const TABLE_QUERY = 'SELECT * FROM c';
/** A column present in every seeded product document. */
const COLUMN = 'price';
/** A distinctive target width, comfortably away from the default. */
const TARGET_WIDTH = 333;

test.describe('queryEditor-column-resize', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        await maximizeWindow(vscodeApp);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
    });

    test.afterEach(async ({ vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('the column header Resize dialog pins an explicit width', async () => {
        const qe = queryEditor!;

        await qe.setQueryText(TABLE_QUERY);
        await qe.run();
        await qe.waitForResults();
        await qe.setViewMode('Table');
        await expect.poll(() => qe.tableRows().count()).toBeGreaterThan(0);

        const before = await qe.columnWidth(COLUMN);
        expect(before).toBeGreaterThan(0);
        // Pick a target that is unambiguously different from the current width.
        expect(Math.abs(before - TARGET_WIDTH)).toBeGreaterThan(20);

        await qe.resizeColumn(COLUMN, TARGET_WIDTH);

        // The header settles to (approximately) the applied width, in either
        // direction from its default.
        await expect.poll(() => qe.columnWidth(COLUMN), { timeout: 10_000 }).toBeGreaterThan(TARGET_WIDTH - 6);
        expect(Math.abs((await qe.columnWidth(COLUMN)) - TARGET_WIDTH)).toBeLessThanOrEqual(5);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('cancelling the Resize dialog leaves the column width untouched', async () => {
        const qe = queryEditor!;

        await qe.setQueryText(TABLE_QUERY);
        await qe.run();
        await qe.waitForResults();
        await qe.setViewMode('Table');
        await expect.poll(() => qe.tableRows().count()).toBeGreaterThan(0);

        const before = await qe.columnWidth(COLUMN);
        expect(before).toBeGreaterThan(0);

        await qe.cancelColumnResize(COLUMN, TARGET_WIDTH);

        // No resize was committed, so the width holds steady at its default.
        await qe.window.waitForTimeout(300);
        expect(Math.abs((await qe.columnWidth(COLUMN)) - before)).toBeLessThanOrEqual(2);

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
