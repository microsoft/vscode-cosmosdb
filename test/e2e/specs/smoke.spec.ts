/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs } from '../fixtures/webviewHelpers';
import { openDocument, openMigrationAssistant, openQueryEditor } from '../fixtures/webviews';

/**
 * Smoke coverage for the three React webviews shipped by the extension.
 *
 * Goals (intentionally minimal):
 *   1. A real VS Code launches with our extension loaded from `dist/`.
 *   2. Each panel opens via the right command path (production for Migration;
 *      test-only `cosmosDB.e2e.*` commands for Document/QueryEditor — see
 *      `src/commands/e2eTestCommands/registerE2eTestCommands.ts`).
 *   3. The React tree inside the webview iframe mounts — i.e. `/views.js`
 *      loads, providers render, `#root` gets children.
 *
 * Anything richer (interactions, asserting specific UI, exercising tRPC
 * round-trips) belongs in dedicated specs that build on these fixtures.
 */
test.describe('webview smoke', () => {
    // Worker-scoped vscodeApp/Window fixtures mean VS Code is reused across
    // tests. Each test must reset editor state itself or panels from one test
    // leak into the next.
    test.afterEach(async ({ vscodeWindow }) => {
        await closeAllEditorTabs(vscodeWindow);
    });

    test('Migration Assistant mounts', async ({ vscodeWindow }) => {
        const webview = await openMigrationAssistant(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();
    });

    test('Query Editor mounts', async ({ vscodeWindow }) => {
        // Connection state depends on env (see `fixtures/webviews.ts`).
        // The mount assertion holds in both modes.
        const webview = await openQueryEditor(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();
    });

    test('Document mounts (add mode)', async ({ vscodeWindow }) => {
        const webview = await openDocument(vscodeWindow);
        await expect(webview.locator('#root')).toBeVisible();
    });
});
