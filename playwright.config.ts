/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defineConfig } from '@playwright/test';
import * as path from 'node:path';
import { ensureE2eIsolationContext } from './test/e2e/helpers/e2eIsolation';

const isolation = ensureE2eIsolationContext();

/**
 * Playwright config for **webview-only** e2e tests.
 *
 * Scope: We launch a real VS Code (downloaded by `@vscode/test-electron`) via
 * Playwright's Electron API and drive only the webview iframes inside it. We
 * do **not** assert against the VS Code shell (tree view, status bar, etc.) —
 * that's the job of the Extension-Host integration tests under
 * [`test/`](./test/) run via `npm run test`.
 *
 * Why a real VS Code instead of Chromium?
 *   - Real `acquireVsCodeApi()`, real CSP, real `--vscode-*` CSS variables,
 *     real Electron version. No mocking the webview environment.
 *   - The test exercises the exact load path users hit (BaseTab.ts → React).
 *
 * Performance: the `vscodeApp` / `vscodeWindow` fixtures are **worker-scoped**
 * (see `test/e2e/fixtures/vscode.ts`), so VS Code is launched once per
 * worker and reused across every test in that worker. Each test resets
 * editor state in its own `afterEach` via `closeAllEditorTabs`.
 *
 * Workers default to 1 because VS Code instances can't share a
 * `--user-data-dir` and each worker needs its own profile. CI can raise it
 * — the isolation context already gives every worker a unique temp subdir.
 *
 * Cosmos DB emulator (Docker): not required for the smoke suite. When a test
 * actually needs a live backend, wire `docker compose up` + seed import into
 * `test/e2e/setup/globalSetup.ts`, mirroring the NoSQL integration suite
 * under `packages/nosql-language-service/`.
 */
export default defineConfig({
    testDir: './test/e2e/specs',
    globalSetup: './test/e2e/setup/globalSetup.ts',
    globalTeardown: './test/e2e/setup/globalTeardown.ts',
    fullyParallel: false,
    workers: 1,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI
        ? [['github'], ['html', { open: 'never', outputFolder: path.join(isolation.reportsRootDir, 'html') }]]
        : [['list'], ['html', { open: 'never', outputFolder: path.join(isolation.reportsRootDir, 'html') }]],
    outputDir: isolation.resultsRootDir,
    // Generous: launching VS Code + activating the extension + opening a panel
    // can take ~15 s on the first run and ~5–8 s on cached runs.
    timeout: 90_000,
    expect: { timeout: 10_000 },

    use: {
        trace: 'on-first-retry',
        video: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },

    // No `webServer` and no `projects` — we don't need a browser. Tests use
    // Playwright's Electron API directly (see `test/e2e/fixtures/vscode.ts`).
});
