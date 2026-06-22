/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QUERY_CONTROLS, QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 1 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * the query toolbar. Verifies every non-gated toolbar control is present, in the
 * correct initial enabled/disabled state, and interactable (menus open/close,
 * actions fire) — all without producing webview console errors.
 *
 * The toolbar is responsive: on a narrow editor area (e.g. a CI virtual screen)
 * the lower-priority controls collapse into a "More items" overflow menu, while
 * Run and Cancel stay pinned. These tests therefore never assume a control is
 * inline — they resolve each control via the page-object helpers that look in
 * the toolbar first and the overflow menu second.
 *
 * Gated controls (AI, Provide Feedback) are environment-dependent and out of
 * scope; the assertions below only target the always-rendered controls.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

test.describe('queryEditor-query-toolbar', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        // Maximize for the widest editor area available; the assertions below
        // still tolerate a small screen where controls start collapsed (the
        // page-object helpers look in the toolbar first, the overflow menu
        // second). See `queryEditor-toolbar-overflow.spec.ts` for the collapse
        // behaviour itself.
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

    test('exposes every control in the correct initial state', async () => {
        const qe = queryEditor!;

        // Run and Cancel are the pinned, non-collapsing actions, so they are
        // always inline regardless of window size.
        await expect(qe.inlineControl(QUERY_CONTROLS.run)).toBeEnabled();
        await expect(qe.inlineControl(QUERY_CONTROLS.cancel)).toBeVisible();
        await expect(qe.inlineControl(QUERY_CONTROLS.cancel)).toBeDisabled();

        // Every other control must be reachable — inline in the toolbar OR in
        // the overflow menu (depending on how much width the screen affords).
        for (const control of [
            QUERY_CONTROLS.open,
            QUERY_CONTROLS.save,
            QUERY_CONTROLS.duplicate,
            QUERY_CONTROLS.learn,
            QUERY_CONTROLS.schema,
            QUERY_CONTROLS.connection,
        ]) {
            await qe.expectControlReachable(control);
        }

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('connection picker shows the seeded database/container', async () => {
        const qe = queryEditor!;

        if (await qe.isControlInline(QUERY_CONTROLS.connection)) {
            // Inline Dropdown renders the current connection as its value.
            const picker = qe.connectionPicker().first();
            await expect(picker).toContainText('nosql-test-db');
            await expect(picker).toContainText('products');
        } else {
            // Collapsed: open the Connect submenu and assert it lists the
            // seeded database (its containers live in a further nested submenu).
            await qe.openControlSubmenu(QUERY_CONTROLS.connection);
            const submenu = qe.frame.getByRole('menu').last();
            await expect(submenu).toContainText('nosql-test-db');
            await qe.dismissMenus();
        }

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('Learn and Schema menus open and close without console errors', async () => {
        const qe = queryEditor!;

        await qe.openControlSubmenu(QUERY_CONTROLS.learn);
        await expect(qe.frame.getByText('Query examples', { exact: true })).toBeVisible();
        await qe.dismissMenus();

        await qe.openControlSubmenu(QUERY_CONTROLS.schema);
        await expect(qe.frame.getByText('Generate schema', { exact: true })).toBeVisible();
        await qe.dismissMenus();

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('Open and Save actions fire without console errors', async () => {
        const qe = queryEditor!;

        // Open pops a host file picker that the fixture stubs to "cancelled",
        // so the action is a safe no-op here.
        await qe.clickControl(QUERY_CONTROLS.open);

        // Save opens a new untitled query document (no dialog). Cleaned up by
        // closeAllEditorTabs in afterEach.
        await qe.clickControl(QUERY_CONTROLS.save);

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('Open and Save also fire via the Ctrl+O / Ctrl+S hotkeys', async () => {
        const qe = queryEditor!;

        // Same actions as the button test, driven by their editor-scoped
        // hotkeys. Ctrl+O (stubbed picker) leaves the Query Editor active, and
        // Ctrl+S — which may open a save target — is issued last so a tab change
        // can't strand a follow-up editor interaction.
        await qe.pressEditorHotkey('Control+O');
        await qe.pressEditorHotkey('Control+S');

        qe.consoleHealth.assertNoConsoleErrors();
    });

    test('query runs via Run button and via F5 hotkey', async () => {
        const qe = queryEditor!;

        // Button path.
        await qe.run();
        await qe.waitForResults('prod-00000');

        // Hotkey path (F5) — focus Monaco, then press the shortcut.
        await qe.runViaHotkey();
        await qe.waitForResults('prod-00000');

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
