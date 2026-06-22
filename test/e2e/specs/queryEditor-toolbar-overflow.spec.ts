/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { QUERY_CONTROLS, QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow, resizeWindow } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 1 (companion to `queryEditor-query-toolbar.spec.ts`): responsive
 * overflow behaviour of the query toolbar.
 *
 * The toolbar is wrapped in a Fluent UI `Overflow`. When the editor area — and
 * therefore the toolbar — is too narrow to show every control inline, the
 * lower-priority controls collapse into a "More items" (⋯) overflow menu, while
 * the two highest-priority actions, **Run** and **Cancel**, stay pinned in the
 * toolbar.
 *
 * This spec verifies that:
 *   - a wide window shows everything inline (no overflow trigger);
 *   - a narrow window surfaces the ⋯ trigger;
 *   - Run and Cancel remain visible in the toolbar when narrow;
 *   - every other control genuinely *leaves* the toolbar (hidden there) and
 *     reappears inside the overflow submenu — i.e. it moved, it didn't get
 *     duplicated or stranded in the panel.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/** Window widths (px) chosen to sit comfortably either side of the collapse. */
const WIDE_WIDTH = 1600;
const NARROW_WIDTH = 720;
const WINDOW_HEIGHT = 1100;

/**
 * Controls that are expected to collapse into the overflow menu when narrow —
 * everything except the pinned Run/Cancel actions. Drawn from the shared
 * `QUERY_CONTROLS` registry so the inline accessible name, role and overflow
 * menu text stay in one place.
 */
const COLLAPSING_CONTROLS = [
    QUERY_CONTROLS.open,
    QUERY_CONTROLS.save,
    QUERY_CONTROLS.duplicate,
    QUERY_CONTROLS.learn,
    QUERY_CONTROLS.schema,
    QUERY_CONTROLS.connection,
];

test.describe('queryEditor-toolbar-overflow', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.beforeEach(async ({ vscodeApp, vscodeWindow }) => {
        // Start wide so the editor opens and connects without any overflow noise.
        await resizeWindow(vscodeApp, WIDE_WIDTH, WINDOW_HEIGHT);
        await attachEmulator(vscodeWindow);
        queryEditor = await QueryEditorPage.open(vscodeWindow);
        await queryEditor.waitForConnected();
    });

    test.afterEach(async ({ vscodeApp, vscodeWindow }) => {
        // Capture the end-of-test (narrow / collapsed) state before restoring
        // the window size.
        await captureNamedScreenshot(vscodeWindow, 'final');
        queryEditor?.dispose();
        queryEditor = undefined;
        // Restore a roomy window so a narrow size can't leak into later specs
        // sharing this worker's VS Code instance.
        await maximizeWindow(vscodeApp);
        await closeAllEditorTabs(vscodeWindow);
    });

    test('collapses non-pinned controls into the overflow submenu when narrow', async ({ vscodeApp }) => {
        const qe = queryEditor!;

        // ─── Wide: everything inline, no overflow ────────────────────────────
        await qe.waitForOverflowState(false);
        await expect(qe.inlineControl(QUERY_CONTROLS.run)).toBeVisible();
        await expect(qe.inlineControl(QUERY_CONTROLS.cancel)).toBeVisible();
        for (const control of COLLAPSING_CONTROLS) {
            await expect(qe.inlineControl(control)).toBeVisible();
        }

        // ─── Narrow: force the toolbar to collapse ───────────────────────────
        await resizeWindow(vscodeApp, NARROW_WIDTH, WINDOW_HEIGHT);
        await qe.waitForOverflowState(true);

        // Run and Cancel are the pinned, non-collapsing actions: still inline.
        await expect(qe.inlineControl(QUERY_CONTROLS.run)).toBeVisible();
        await expect(qe.inlineControl(QUERY_CONTROLS.cancel)).toBeVisible();

        // Every other control has *left* the toolbar (present but hidden there).
        for (const control of COLLAPSING_CONTROLS) {
            await expect(qe.inlineControl(control)).toBeHidden();
        }

        // ─── The collapsed controls now live in the overflow submenu ─────────
        expect(await qe.openOverflowMenu()).toBe(true);
        const menu = qe.overflowMenu();
        for (const control of COLLAPSING_CONTROLS) {
            await expect(menu).toContainText(control.menuText);
        }

        // Run and Cancel stayed in the panel, so they are NOT duplicated into
        // the submenu (`ToolbarOverflowMenuItem` renders nothing for an item
        // that is still visible in the toolbar).
        await expect(menu).not.toContainText('Run');
        await expect(menu).not.toContainText('Cancel');

        await qe.dismissMenus();

        qe.consoleHealth.assertNoConsoleErrors();
    });
});
