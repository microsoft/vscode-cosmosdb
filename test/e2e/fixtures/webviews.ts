/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-webview test helpers — one `open*` function for each of the three React
 * panels under `src/webviews/cosmosdb/`:
 *
 *   - Document          (`DocumentTab`,           viewType `cosmosDbDocument`)
 *   - Query Editor      (`QueryEditorTab`,        viewType `cosmosDbQuery`)
 *   - Migration         (`MigrationAssistantTab`, viewType `cosmosDbMigration`)
 *
 * Each helper:
 *   1. Triggers the right VS Code command (production for Migration, the
 *      `cosmosDB.e2e.*` test-only commands for Document/QueryEditor — see
 *      `src/commands/e2eTestCommands/registerE2eTestCommands.ts` for why).
 *   2. Waits for the webview iframe to mount and for the React tree to render
 *      its first child into `#root`.
 *   3. Returns the inner content `Frame` so the test can drive the UI.
 *
 * Why not always use the production command IDs?
 * Production `cosmosDB.openNoSqlQueryEditor` / `cosmosDB.openDocument` require
 * either a connected Cosmos DB tree node or pop a `pickAppResource` quick-pick.
 * Neither exists in a fresh test VS Code with no accounts. The test commands
 * call the panel constructors directly, so the webview HTML loads and React
 * mounts; backend-bound tRPC calls (`getInitialState` etc.) may fail at the
 * network layer but that's surfaced through the normal error-toast pipeline —
 * exactly the shape of an isolated "webview smoke" test.
 */

import { type Frame, type Page } from '@playwright/test';
import { getWebviewByPredicate, runCommand } from './webviewHelpers';

/**
 * Predicate that matches any webview frame whose `<div id="root">` has at
 * least one child element. Selecting the frame by this condition both
 * disambiguates from VS Code's own internal frames AND waits for the React
 * tree to mount — no separate "wait for render" step needed.
 */
const REACT_ROOT_RENDERED = async (frame: Frame): Promise<boolean> => {
    return (await frame.locator('#root > *').count()) > 0;
};

/**
 * Opens the Migration Assistant panel and returns its content frame.
 * Uses the production command — Migration only needs a workspace folder,
 * which the `vscodeApp` fixture already provides.
 */
export async function openMigrationAssistant(page: Page): Promise<Frame> {
    // Title "New Migration…" comes from `cosmosdb.command.migration.open` in
    // package.nls.json. Category prefix is "Cosmos DB:" (from the command's
    // `category` field).
    await runCommand(page, 'Cosmos DB: New Migration');
    return getWebviewByPredicate(page, REACT_ROOT_RENDERED);
}

/**
 * Opens the Query Editor panel and returns its content frame. Uses the
 * `cosmosDB.e2e.openQueryEditor` test-only command, which calls
 * `QueryEditorTab.render(connection)` directly.
 *
 * Connection state depends on whether the Playwright fixture exported
 * emulator env vars:
 *  - With `COSMOSDB_E2E_EMULATOR_*` present (default `npm run e2e`) — opens
 *    against the seeded e2e emulator (`nosql-test-db / products` by default).
 *  - With `COSMOSDB_E2E_SKIP_EMULATOR=1` — opens in disconnected state, the
 *    user is prompted to pick a connection.
 *
 * Both modes still mount the React tree, which is enough for the smoke
 * assertion (`#root` has children).
 */
export async function openQueryEditor(page: Page): Promise<Frame> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Open Query Editor');
    return getWebviewByPredicate(page, REACT_ROOT_RENDERED);
}

/**
 * Opens the Document panel in 'add' mode with a stub connection, returning
 * its content frame. Uses the `cosmosDB.e2e.openDocument` test-only command.
 *
 * The stub connection doesn't point at a real backend, so any tRPC call
 * that hits the network will fail — but the React tree still mounts, which
 * is the point of a smoke test.
 */
export async function openDocument(page: Page): Promise<Frame> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Open Document');
    return getWebviewByPredicate(page, REACT_ROOT_RENDERED);
}

/**
 * Attaches the e2e Cosmos DB emulator (started by `globalSetup`) to the
 * workspace via the `cosmosDB.e2e.attachEmulator` test-only command. After
 * this returns the Cosmos DB Workspaces tree contains an entry named
 * `E2E Emulator (<databaseId>)` pointing at the seeded emulator endpoint.
 *
 * The command is idempotent — re-running it just overwrites the existing
 * entry with the same content hash.
 *
 * Throws if `COSMOSDB_E2E_SKIP_EMULATOR=1` was set: the command itself will
 * throw because no emulator env vars are in scope.
 */
export async function attachEmulator(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Attach Emulator to Workspace');
    // No webview to wait for; the command resolves synchronously and writes
    // to globalState + secretStorage. Give VS Code a beat to flush.
    await page.waitForTimeout(250);
}
