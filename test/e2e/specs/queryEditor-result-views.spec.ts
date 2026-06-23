/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ResultViewMode, QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 2 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * the three result view modes. After running the default query, the same seeded
 * document (`prod-00000`) must be visible whether it is rendered as a Table, a
 * Tree, or raw JSON, and switching modes must not emit webview console errors.
 *
 * The view-mode switch is driven through the result-panel "Change view mode"
 * dropdown via the page-object helpers (`setViewMode` / `getActiveViewMode`),
 * which also assert the matching renderer actually mounts.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/** The deterministic first product of the seed — present on the first result page. */
const SEEDED_ID = 'prod-00000';

test.describe('queryEditor-result-views', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        await maximizeWindow(vscodeApp);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
        // Run the default `SELECT * FROM c` so every view mode has data to render.
        await queryEditor.run();
        await queryEditor.waitForResults(SEEDED_ID);
    });

    test.afterEach(async ({ vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('defaults to the Table view with the seeded data', async () => {
        const qe = queryEditor!;

        expect(await qe.getActiveViewMode()).toBe('Table');
        await expect(qe.activeViewContainer('Table')).toBeVisible();
        await qe.expectRow(SEEDED_ID);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('renders the seeded data in Tree, JSON and Table views', async () => {
        const qe = queryEditor!;

        // Cycle away from the default and back, asserting each renderer mounts
        // and still surfaces the same seeded document id.
        const modes: ResultViewMode[] = ['Tree', 'JSON', 'Table'];
        for (const mode of modes) {
            await qe.setViewMode(mode);
            expect(await qe.getActiveViewMode()).toBe(mode);
            await expect(qe.activeViewContainer(mode)).toBeVisible();
            await qe.expectRow(SEEDED_ID);
        }

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
