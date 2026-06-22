/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 14 of the Query Editor e2e coverage: the Cancel control.
 *
 * The Cancel button is disabled at rest and enabled only while a query is
 * executing (`state.isExecuting`). Clicking it aborts the in-flight query and
 * returns the toolbar to the idle state (Run re-enabled, Cancel disabled).
 *
 * The seeded emulator answers simple queries near-instantly, so to keep the
 * "executing" window observable we run a deliberately expensive cross-partition
 * self-join over the `tags` arrays — its combinatorial blow-up keeps the query
 * busy long enough to catch and cancel.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/**
 * A deliberately heavy query: ten self-joins over each document's `tags` array
 * produce a large combinatorial intermediate the emulator must enumerate before
 * the COUNT resolves — slow enough that the Cancel button is reliably catchable.
 */
const HEAVY_QUERY = [
    'SELECT VALUE COUNT(1) FROM c',
    'JOIN a IN c.tags JOIN b IN c.tags JOIN d IN c.tags JOIN e IN c.tags JOIN f IN c.tags',
    'JOIN g IN c.tags JOIN h IN c.tags JOIN i IN c.tags JOIN j IN c.tags JOIN k IN c.tags',
].join(' ');

test.describe('queryEditor-cancel', { tag: '@queryEditor' }, () => {
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

    test('Cancel aborts an in-flight query and restores the idle toolbar', async () => {
        const qe = queryEditor!;

        // At rest: nothing is executing, so Cancel is disabled and Run is live.
        await expect(qe.cancelButton()).toBeDisabled();
        await expect(qe.runButton()).toBeEnabled();

        await qe.setQueryText(HEAVY_QUERY);
        await qe.run();

        // While the heavy query runs, the toolbar flips: Cancel becomes enabled
        // (and Run goes disabled).
        await expect(qe.cancelButton()).toBeEnabled({ timeout: 15_000 });
        await expect(qe.runButton()).toBeDisabled();

        await qe.cancelQuery();

        // Cancelling ends execution and restores the idle toolbar.
        await expect(qe.runButton()).toBeEnabled({ timeout: 20_000 });
        await expect(qe.cancelButton()).toBeDisabled();

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
