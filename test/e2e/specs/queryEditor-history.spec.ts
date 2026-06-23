/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 6 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * the Run split-button query history. Executing a query records its (cleaned)
 * text in the Run button's history menu; selecting a history entry loads it
 * back into the editor.
 *
 * History is persisted per container in the extension's storage, so other
 * specs sharing the worker may have already populated it — these tests never
 * assert an empty baseline, only that a freshly-run, distinctive query shows
 * up and round-trips.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/**
 * A distinctive, non-`SELECT *` query touching the indexed `price` path. Kept
 * under 50 characters so the history menu shows it verbatim (longer entries are
 * truncated with an ellipsis).
 */
const HISTORY_QUERY = 'SELECT c.id FROM c WHERE c.price > 1.5';

test.describe('queryEditor-history', { tag: '@queryEditor' }, () => {
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

    test('records an executed query in the Run history menu', async () => {
        const qe = queryEditor!;

        await qe.setQueryText(HISTORY_QUERY);
        await qe.run();
        await qe.waitForResults('prod-');

        await qe.openRunHistoryMenu();
        const entries = await qe.getHistoryEntries();
        expect(entries.some((entry) => entry.includes('c.price > 1.5'))).toBe(true);

        // Leave the menu closed so cleanup isn't blocked by an open popover.
        await qe.dismissMenus();

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('selecting a history entry loads it back into the editor', async () => {
        const qe = queryEditor!;

        // Record the query, then wipe the editor so the insert is observable.
        await qe.setQueryText(HISTORY_QUERY);
        await qe.run();
        await qe.waitForResults('prod-');
        await qe.setQueryText('');
        await expect.poll(() => qe.getQueryText()).not.toContain('c.price > 1.5');

        // Pick the history entry from the Run menu → it repopulates the editor.
        await qe.openRunHistoryMenu();
        await qe.frame
            .getByRole('menuitem', { name: /c\.price > 1\.5/ })
            .first()
            .click();

        await expect.poll(() => qe.getQueryText()).toContain('c.price > 1.5');

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
