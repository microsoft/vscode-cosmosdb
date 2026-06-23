/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import {
    captureNamedScreenshot,
    closeAllEditorTabs,
    countEditorTabs,
    maximizeWindow,
} from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 12 of the Query Editor e2e coverage: the "Duplicate" toolbar control
 * spawns a second Query Editor tab pre-seeded with the current editor text
 * (`QueryEditorTab.render(..., query)` via the `duplicateTab` tRPC mutation).
 *
 * The test sets a distinctive query in the first tab, duplicates it, and proves
 * a *second*, independent webview opened carrying the same query text — without
 * disturbing the original tab.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/** A distinctive, single-line query so the duplicate's text is unambiguous. */
const DISTINCT_QUERY = 'SELECT c.id FROM c WHERE c.price > 987654';
const DISTINCT_FRAGMENT = 'c.price > 987654';

test.describe('queryEditor-duplicate-tab', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;
    let duplicate: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        await maximizeWindow(vscodeApp);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
    });

    test.afterEach(async ({ vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        duplicate?.dispose();
        duplicate = undefined;
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('the Duplicate control opens a second tab carrying the same query', async ({ vscodeWindow }) => {
        const qe = queryEditor!;

        await qe.setQueryText(DISTINCT_QUERY);
        await expect.poll(() => qe.getQueryText()).toContain(DISTINCT_FRAGMENT);
        await expect.poll(() => countEditorTabs(vscodeWindow)).toBe(1);

        await qe.duplicateTab();

        // A brand-new editor tab appears…
        await expect.poll(() => countEditorTabs(vscodeWindow), { timeout: 15_000 }).toBe(2);

        // …and it is a distinct webview whose editor holds the same query text.
        duplicate = await QueryEditorPage.attachOther(vscodeWindow, qe.frame);
        expect(duplicate.frame).not.toBe(qe.frame);
        await expect.poll(() => duplicate!.getQueryText(), { timeout: 15_000 }).toContain(DISTINCT_FRAGMENT);

        // The original tab is untouched.
        await expect.poll(() => qe.getQueryText()).toContain(DISTINCT_FRAGMENT);

        qe.consoleHealth.assertNoConsoleErrors();
        duplicate.consoleHealth.assertNoConsoleErrors();
    });
});
