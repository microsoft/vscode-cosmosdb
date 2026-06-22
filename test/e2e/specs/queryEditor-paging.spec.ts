/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import {
    captureNamedScreenshot,
    closeAllEditorTabs,
    maximizeWindow,
    resetNativeDialogStubs,
    stubMessageBoxButton,
} from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 4 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * paging and the page-size control. Exercises both page-size paths — changing
 * it before a query runs is silent, while changing it after a query has run
 * re-runs the query behind a VS Code workbench confirmation modal — plus the
 * First/Prev/Next page navigation and the status-bar record range.
 *
 * The `products` container holds 200 seeded, deterministically-ordered
 * documents (`prod-00000`…`prod-00199`), so a page size of 10 yields a stable
 * `0 - 10` / `10 - 20` range with `prod-00000` and `prod-00010` as page anchors.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/** A stable, ascending-id query so page N starts at prod-000N0. */
const ORDERED_QUERY = 'SELECT * FROM c ORDER BY c.id';

test.describe('queryEditor-paging', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        await maximizeWindow(vscodeApp);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
    });

    test.afterEach(async ({ vscodeApp, vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        // Restore the default native-dialog stubs in case a test overrode them.
        await resetNativeDialogStubs(vscodeApp);
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('changes page size silently before a query has run', async () => {
        const qe = queryEditor!;

        // No query has executed yet, so changing the page size just updates the
        // value — no confirmation modal should appear.
        await qe.setPageSize('10');
        expect(await qe.getPageSizeValue()).toBe('10');
        await expect(qe.pageSizeModal()).toHaveCount(0);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('navigates First / Prev / Next pages with the expected record range', async () => {
        const qe = queryEditor!;

        // Set a small page size up front (silent — no query has run yet), then
        // run so the small page takes effect without a confirmation modal.
        await qe.setPageSize('10');
        await qe.setQueryText(ORDERED_QUERY);
        await qe.run();
        await qe.waitForResults('prod-00000');
        expect(await qe.getStatusRange()).toBe('0 - 10');

        // Next page → second slice of ids.
        await qe.goToNextPage();
        await qe.waitForResults('prod-00010');
        expect(await qe.getStatusRange()).toBe('10 - 20');

        // Prev page → back to the first slice.
        await qe.goToPrevPage();
        await qe.waitForResults('prod-00000');
        expect(await qe.getStatusRange()).toBe('0 - 10');

        // Advance again, then First page jumps straight back to the start.
        await qe.goToNextPage();
        await qe.waitForResults('prod-00010');
        await qe.goToFirstPage();
        await qe.waitForResults('prod-00000');
        expect(await qe.getStatusRange()).toBe('0 - 10');

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('confirms a page-size change after a query and re-runs at the new size', async ({ vscodeApp }) => {
        const qe = queryEditor!;

        // Run at the default page size (100) first.
        await qe.setQueryText(ORDERED_QUERY);
        await qe.run();
        await qe.waitForResults('prod-00000');
        expect(await qe.getStatusRange()).toBe('0 - 100');

        // Changing the page size now re-runs the query, which the backend guards
        // with a confirmation prompt. That prompt is a native Electron dialog,
        // so we deterministically "click" its Continue button via the stub.
        await stubMessageBoxButton(vscodeApp, 'Continue');
        await qe.setPageSize('10');

        // Confirmed → query re-ran at the new size.
        await qe.waitForResults('prod-00000');
        await expect.poll(() => qe.getPageSizeValue()).toBe('10');
        expect(await qe.getStatusRange()).toBe('0 - 10');

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('declining the page-size confirmation leaves the page size unchanged', async ({ vscodeApp }) => {
        const qe = queryEditor!;

        await qe.setQueryText(ORDERED_QUERY);
        await qe.run();
        await qe.waitForResults('prod-00000');
        expect(await qe.getPageSizeValue()).toBe('100');

        // Trigger the re-run confirmation, then decline it via the native dialog
        // stub (pick the close/cancel affordance).
        await stubMessageBoxButton(vscodeApp, 'Close');
        await qe.setPageSize('10');

        // Declined → no re-run; the original page size and range stand. Give the
        // (async) decline a beat to settle before asserting nothing changed.
        await qe.window.waitForTimeout(1_500);
        expect(await qe.getPageSizeValue()).toBe('100');
        expect(await qe.getStatusRange()).toBe('0 - 100');

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
