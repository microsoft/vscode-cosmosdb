/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Locator, type Page } from '@playwright/test';
import { QueryEditorPage } from '../fixtures/queryEditor';
import { expect, test } from '../fixtures/vscode';
import { captureNamedScreenshot, closeAllEditorTabs, maximizeWindow, runCommand } from '../fixtures/webviewHelpers';
import { attachEmulator } from '../fixtures/webviews';

/**
 * Phase 7 of the Query Editor e2e coverage (see `plans/queryeditor-e2e-plan.md`):
 * the production entry point. Every other spec opens the editor through the
 * `cosmosDB.e2e.openQueryEditor` test command; this one instead drives the real
 * user path — expanding the attached emulator in the Cosmos DB Workspaces tree
 * down to a container and invoking the "Open Query Editor" context-menu action —
 * to prove that production affordance still mounts a working editor.
 *
 * This is intentionally the *only* tree-driven spec: tree navigation is slower
 * and more brittle than the command shortcut, so the rest of the suite avoids
 * it.
 *
 * Needs a live, seeded emulator (skipped under `COSMOSDB_E2E_SKIP_EMULATOR=1`).
 */
const emulatorSkipped = process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';

/** The seeded database / container the tree path drills into. */
const DATABASE_ID = 'nosql-test-db';
const CONTAINER_ID = 'products';

/** Matches a Workspaces-tree row by the start of its accessible name. Prefix
 *  matching avoids the substring collision between the database node
 *  (`nosql-test-db`) and the emulator account (`E2E Emulator (nosql-test-db)`). */
function treeRow(pane: Locator, labelPrefix: string): Locator {
    return pane.locator(`.monaco-list-row[aria-label^="${labelPrefix}"]`).first();
}

/** Expands a (collapsed) tree row and waits until its children are loaded. */
async function expandTreeRow(row: Locator): Promise<void> {
    await row.waitFor({ state: 'visible', timeout: 20_000 });
    if ((await row.getAttribute('aria-expanded')) === 'false') {
        await row.click();
        await expect(row).toHaveAttribute('aria-expanded', 'true', { timeout: 30_000 });
    }
}

test.describe('queryEditor-tree-open', { tag: '@queryEditor' }, () => {
    test.skip(emulatorSkipped, 'COSMOSDB_E2E_SKIP_EMULATOR=1 — Query Editor tests need a live backend');

    let queryEditor: QueryEditorPage | undefined;

    test.afterEach(async ({ vscodeWindow }) => {
        await captureNamedScreenshot(vscodeWindow, 'final');
        queryEditor?.dispose();
        queryEditor = undefined;
        await closeAllEditorTabs(vscodeWindow);
    });

    test('opens the editor from the Workspaces tree container action', async ({ vscodeApp, vscodeWindow }) => {
        const win: Page = vscodeWindow;
        await maximizeWindow(vscodeApp);
        await attachEmulator(win);

        // Reveal the Cosmos DB Workspaces tree and scope to its pane.
        await runCommand(win, 'Azure: Focus on Workspace View');
        await win.keyboard.press('Escape');
        const workspacePane = win
            .locator('.pane', { has: win.locator('.pane-header', { hasText: 'Workspace' }) })
            .first();
        await expect(treeRow(workspacePane, 'Cosmos DB Accounts')).toBeVisible({ timeout: 20_000 });

        // Drill down: Cosmos DB Accounts → Local Emulators → E2E Emulator →
        // database → container.
        await expandTreeRow(treeRow(workspacePane, 'Cosmos DB Accounts'));
        await expandTreeRow(treeRow(workspacePane, 'Local Emulators'));
        await expandTreeRow(treeRow(workspacePane, 'E2E Emulator'));
        await expandTreeRow(treeRow(workspacePane, DATABASE_ID));

        const container = treeRow(workspacePane, CONTAINER_ID);
        await expect(container).toBeVisible({ timeout: 30_000 });

        // Invoke the production "Open Query Editor" context-menu action.
        await container.click();
        await container.click({ button: 'right' });
        const contextMenu = win.locator('.context-view .monaco-menu').first();
        await contextMenu.waitFor({ state: 'visible', timeout: 10_000 });
        await contextMenu.getByText('Open Query Editor', { exact: true }).click();

        // The tree action mounts a fully-wired Query Editor webview.
        queryEditor = await QueryEditorPage.fromOpenTab(win);
        await queryEditor.waitForConnected();

        // Best-effort: the editor is connected, so the default query returns the
        // seeded data end-to-end through the production path.
        await queryEditor.run();
        await queryEditor.waitForResults('prod-00000');

        queryEditor.consoleHealth.assertNoConsoleErrors();
    });
});
