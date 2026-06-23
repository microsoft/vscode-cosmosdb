/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 11 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * the two non-happy paths.
 *
 *  - **Empty result** — a syntactically valid query that matches nothing renders
 *    an empty grid (zero data rows) without error.
 *  - **Invalid query** — a malformed query surfaces a VS Code error
 *    notification (the extension catches the backend 400 and routes it
 *    through the error pipeline rather than crashing the panel).
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

const SEEDED_ID = 'prod-00000';
const NO_MATCH_QUERY = 'SELECT TOP 10 * FROM c WHERE c.price > 1000000';
const INVALID_QUERY = 'SELECT undefinedFunction(c.id) FROM c';

test.describe('queryEditor-errors', { tag: '@queryEditor' }, () => {
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

    test('a query that matches nothing renders an empty result grid', async () => {
        const qe = queryEditor!;

        // Run the default query first so there are rows to clear — proves the
        // grid actually transitions to empty rather than starting empty.
        await qe.run();
        await qe.waitForResults(SEEDED_ID);
        await expect.poll(() => qe.tableRows().count()).toBeGreaterThan(0);

        await qe.setQueryText(NO_MATCH_QUERY);
        await qe.run();
        await expect.poll(() => qe.tableRows().count(), { timeout: 15_000 }).toBe(0);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('an invalid query surfaces a backend error notification', async ({ vscodeWindow }) => {
        const qe = queryEditor!;

        await qe.setQueryText(INVALID_QUERY);
        await qe.run();

        // The backend rejects the malformed query with a 400; the extension
        // catches it and raises a VS Code error notification instead of
        // crashing the panel. The grid stays empty.
        await expect(vscodeWindow.getByText(/Query failed with status code/i).first()).toBeVisible({
            timeout: 15_000,
        });
        await expect.poll(() => qe.tableRows().count()).toBe(0);

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
