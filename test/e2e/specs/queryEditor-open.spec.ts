/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QueryEditorPage } from '../fixtures/queryEditor';
import { test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 0 tracer bullet for the Query Editor e2e coverage (see
 * `plans/queryeditor-e2e-plan.md`). Proves the whole rig in one tiny slice and
 * exercises the two shared helpers (`QueryEditorPage` + console-health) in
 * their thinnest form:
 *
 *   open → run default `SELECT * FROM c` → assert a seeded row appears →
 *   assert no webview console errors.
 *
 * Like `emulator-connected.spec.ts`, this needs a live, seeded emulator, so it
 * is skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1` (the tRPC calls would hang
 * with no backend).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

test.describe('queryEditor-open', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.afterEach(async ({ vscodeWindow }) => {
        // "After" screenshot — the end-of-test state, paired with the "loaded"
        // shot taken when the editor opened.
        await captureNamedScreenshot(vscodeWindow, 'final');
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('open + run returns seeded rows with no console errors', async ({ vscodeWindow }) => {
        // Ensure the seeded emulator is attached to the workspace (idempotent).
        await attachEmulator(vscodeWindow);

        queryEditor = await QueryEditorPage.open(vscodeWindow);

        await queryEditor.run();
        await queryEditor.waitForResults('prod-00000');

        queryEditor.consoleHealth.assertNoConsoleErrors();
    });
});
