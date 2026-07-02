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
 * Opens the Migration Assistant against a deterministic, pre-seeded project
 * via the `cosmosDB.e2e.openMigration` test-only command. The seed (consent
 * granted, application analysis populated, schema files present) lets phase-flow
 * specs drive Discovery → Assessment → Conversion without the native file
 * pickers. The migration AI layer is mocked (see
 * `src/panels/migration/helpers/e2eMigrationAiMock.ts`), so the phases run
 * offline and deterministically.
 */
export async function openMigrationSeeded(page: Page): Promise<Frame> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Open Seeded Migration Assistant');
    return getWebviewByPredicate(page, REACT_ROOT_RENDERED);
}

/**
 * Opens the Migration Assistant against a fresh, empty project via the
 * `cosmosDB.e2e.openMigrationFresh` test-only command. Use to assert the
 * initial disabled-control state (no consent, no analysis).
 */
export async function openMigrationFresh(page: Page): Promise<Frame> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Open Empty Migration Assistant');
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

/**
 * Forces the extension's AI-features flag on via the
 * `cosmosDB.e2e.setAIFeaturesEnabled` test-only command. The AI button in the
 * Query Editor toolbar only renders when AI features are enabled (i.e. Copilot
 * is available), which isn't the case in a fresh test VS Code. Call this
 * BEFORE `openQueryEditor` so the panel's initial state reports AI as enabled.
 */
export async function setAIFeaturesEnabled(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Enable AI Features');
    // The command resolves synchronously; give VS Code a beat to apply it.
    await page.waitForTimeout(250);
}

/**
 * Installs a fixed pair of fake Copilot models via the
 * `cosmosDB.e2e.setMockLanguageModels` test-only command. With two models
 * available the Generate Query input renders its model-switcher `Combobox`
 * (instead of a single-model static label), and selection works without a
 * real Copilot installation. Call this BEFORE opening the Generate Query
 * input so the model list is in place when the input fetches it.
 *
 * The model names are defined alongside the command in
 * `src/commands/e2eTestCommands/registerE2eTestCommands.ts`.
 */
export async function setMockLanguageModels(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Set Mock Language Models');
    // The command resolves synchronously; give VS Code a beat to apply it.
    await page.waitForTimeout(250);
}

/**
 * Clears the fake-model override installed by {@link setMockLanguageModels} via
 * the `cosmosDB.e2e.clearMockLanguageModels` command. Call this in spec teardown
 * so the mock models don't leak into other specs sharing the worker VS Code.
 */
export async function clearMockLanguageModels(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Clear Mock Language Models');
    // The command resolves synchronously; give VS Code a beat to apply it.
    await page.waitForTimeout(250);
}

/**
 * Forces the survey-candidate flag on via the `cosmosDB.e2e.setSurveyCandidate`
 * test-only command so the thumbs up/down feedback buttons in the Generate
 * Query input render regardless of the test VS Code's
 * `telemetry.feedback.enabled` setting. Call this AFTER opening the Query
 * Editor (it broadcasts to already-open tabs).
 */
export async function setSurveyCandidate(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Set Survey Candidate');
    // The command resolves synchronously; give VS Code a beat to apply it.
    await page.waitForTimeout(250);
}

/**
 * Routes the mock language model down its success branch so the `generateQuery`
 * tRPC mutation runs through the real `generateQueryWithLLM` service and returns
 * a query (`SELECT * FROM c WHERE c.price < 20`). Requires the mock models to be
 * installed first (see {@link setMockLanguageModels}). Call this BEFORE
 * submitting a prompt.
 */
export async function setMockGenerateQuerySuccess(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Set Mock Generate Query (Success)');
    await page.waitForTimeout(250);
}

/**
 * Routes the mock language model down its error branch so the real
 * `generateQueryWithLLM` service parses an `ERROR:`-prefixed response into a
 * `QueryGenerationRefusedError`, surfacing the error UI path. Requires the mock
 * models to be installed first (see {@link setMockLanguageModels}). Call this
 * BEFORE submitting a prompt.
 */
export async function setMockGenerateQueryError(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Set Mock Generate Query (Error)');
    await page.waitForTimeout(250);
}

/**
 * Routes the mock language model down its schema-tool branch: the first round
 * streams a `cosmosdb_sampleContainerSchema` tool call, so the real
 * `generateQueryWithLLM` agentic loop runs and renders the Allow/Not now dialog;
 * the next round streams the query. Requires a live connection (the emulator),
 * since `onConfirm` only fires when the editor is connected. Call this BEFORE
 * submitting a prompt.
 */
export async function setMockGenerateQueryConfirm(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Set Mock Generate Query (Confirm)');
    await page.waitForTimeout(250);
}

/**
 * Routes the mock language model down its latency branch: `sendRequest` stalls
 * until the request's cancellation token fires, so a test can click Cancel to
 * abort an in-flight generation. Needs no connection. Call this BEFORE
 * submitting a prompt.
 */
export async function setMockGenerateQueryLatency(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Set Mock Generate Query (Latency)');
    await page.waitForTimeout(250);
}

/**
 * Clears the generate-query mock route so nothing leaks into other specs.
 */
export async function clearMockGenerateQueryResult(page: Page): Promise<void> {
    await runCommand(page, 'Cosmos DB: [E2E Test] Clear Mock Generate Query Result');
    await page.waitForTimeout(250);
}
