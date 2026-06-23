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
 * Phase 15 of the Query Editor e2e coverage: the global keyboard hotkeys
 * (`QueryEditorGlobalHotkeys`). These fire from the webview's document-level
 * listener regardless of which sub-panel holds focus, so they are the most
 * robust to drive from an e2e test:
 *
 *  - **Alt+1 / Alt+2** — switch between the Result and Stats result tabs.
 *  - **Alt+Shift+D** — duplicate the editor into a second tab.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

const DISTINCT_QUERY = 'SELECT c.id FROM c WHERE c.price > 123456';
const DISTINCT_FRAGMENT = 'c.price > 123456';

test.describe('queryEditor-hotkeys', { tag: '@queryEditor' }, () => {
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

    test('Alt+2 / Alt+1 switch between the Stats and Result tabs', async () => {
        const qe = queryEditor!;

        await qe.run();
        await qe.waitForResults();

        // Move focus into the result panel so the document-level hotkey listener
        // receives the keystrokes, and confirm the Result tab starts active.
        await qe.focusResultPanel();
        await expect.poll(() => qe.isResultTabSelected('Result')).toBe(true);

        await qe.window.keyboard.press('Alt+2');
        await expect.poll(() => qe.isResultTabSelected('Stats'), { timeout: 10_000 }).toBe(true);

        await qe.window.keyboard.press('Alt+1');
        await expect.poll(() => qe.isResultTabSelected('Result'), { timeout: 10_000 }).toBe(true);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('Alt+Shift+D duplicates the editor into a second tab', async ({ vscodeWindow }) => {
        const qe = queryEditor!;

        await qe.setQueryText(DISTINCT_QUERY);
        await expect.poll(() => qe.getQueryText()).toContain(DISTINCT_FRAGMENT);
        await expect.poll(() => countEditorTabs(vscodeWindow)).toBe(1);

        // The duplicate hotkey is global, so it fires with focus still in the
        // editor after typing.
        await qe.window.keyboard.press('Alt+Shift+D');

        await expect.poll(() => countEditorTabs(vscodeWindow), { timeout: 15_000 }).toBe(2);

        duplicate = await QueryEditorPage.attachOther(vscodeWindow, qe.frame);
        await expect.poll(() => duplicate!.getQueryText(), { timeout: 15_000 }).toContain(DISTINCT_FRAGMENT);

        qe.consoleHealth.assertNoConsoleErrors();
        duplicate.consoleHealth.assertNoConsoleErrors();
    });
});
