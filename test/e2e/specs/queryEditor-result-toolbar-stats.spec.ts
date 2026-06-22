/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 3 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * the result toolbar and the Stats tab. After a query runs, Reload must re-run
 * it, the Stats tab must surface query metrics, an index-using query must
 * populate the index-metrics panel, and Copy/Export must be invocable without
 * error (their clipboard / save-dialog side effects are environment-stubbed, so
 * we only assert the actions wire up cleanly).
 *
 * Result-toolbar controls are resolved through the page-object helpers, which
 * look in the toolbar first and the "More items" overflow menu second (the
 * toolbar collapses on narrow screens).
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

const SEEDED_ID = 'prod-00000';

test.describe('queryEditor-result-toolbar-stats', { tag: '@queryEditor' }, () => {
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

    test('Reload re-runs the query and still shows rows', async () => {
        const qe = queryEditor!;

        await qe.run();
        await qe.waitForResults(SEEDED_ID);

        await qe.reloadResults();
        await qe.waitForResults(SEEDED_ID);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('Stats tab shows query metrics and index metrics for an index-using query', async () => {
        const qe = queryEditor!;

        // ORDER BY forces the engine to use the (default, all-paths) index on
        // /id, so the result carries index-utilization metrics. Ascending id
        // keeps prod-00000 the first row.
        await qe.setQueryText('SELECT * FROM c ORDER BY c.id');
        await qe.run();
        await qe.waitForResults(SEEDED_ID);

        await qe.switchToStatsTab();

        expect(await qe.hasQueryMetrics()).toBe(true);
        await expect(qe.resultRegion()).toContainText('Request Charge');
        expect(await qe.hasIndexMetrics()).toBe(true);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('Copy and Export actions are invocable without error', async () => {
        const qe = queryEditor!;

        await qe.run();
        await qe.waitForResults(SEEDED_ID);

        // Copy writes to the host clipboard via the extension; Export opens a
        // save dialog that the fixture stubs to "cancelled". Both should run
        // without throwing or logging console errors.
        await qe.copyResults('JSON');
        await qe.exportResults('JSON');

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
