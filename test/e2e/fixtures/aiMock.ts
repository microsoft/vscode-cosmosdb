/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Control-file fixtures for the shared e2e AI mock.
 *
 * The Playwright worker and the extension host share a per-worker directory
 * (`COSMOSDB_E2E_AI_MOCK_DIR`, created by `./vscode`). Writing a small JSON
 * control file there tells the extension's mock dispatcher
 * (`src/commands/e2eTestCommands/e2eAiMock.ts`) which feature/route to play and
 * whether to add latency — no per-scenario VS Code command required.
 *
 * Feature ids must match those registered on the extension side (e.g.
 * `GENERATE_QUERY_MOCK_FEATURE`). Install the mock model first with
 * `setMockLanguageModels` so `getSelectedModel` returns the mock.
 */

import { clearJsonControl, writeJsonControl } from './controlFile';

const CONTROL_FILE = 'ai-mock.json';

/** Shape written into the control file; mirrors the extension-side `AiMockControl`. */
export interface AiMockControl {
    /** Feature whose response catalogue to dispatch to. */
    feature: string;
    /** Route within that feature's catalogue. */
    route?: string;
    /** Optional latency (ms) applied to every request — used to exercise Cancel. */
    delayMs?: number;
}

function controlDir(): string {
    const dir = process.env.COSMOSDB_E2E_AI_MOCK_DIR;
    if (!dir) {
        throw new Error('COSMOSDB_E2E_AI_MOCK_DIR is not set — the Playwright fixture must create the AI-mock dir.');
    }
    return dir;
}

/**
 * Writes the AI-mock control file, selecting the feature/route (and optional
 * latency) the extension's mock dispatcher plays on the next LLM request(s).
 * Rewriting resets the mock's per-request sequence (via the file mtime).
 */
export function setAiMock(control: AiMockControl): void {
    writeJsonControl(controlDir(), CONTROL_FILE, control);
}

/** Removes the control file so the mock goes inert and nothing leaks between specs. */
export function clearAiMock(): void {
    const dir = process.env.COSMOSDB_E2E_AI_MOCK_DIR;
    if (dir) {
        clearJsonControl(dir, CONTROL_FILE);
    }
}

// ─── Generate Query helpers ─────────────────────────────────────────
// Kept in lockstep with the `generateQuery` catalogue registered in
// `src/commands/e2eTestCommands/generateQueryMockModel.ts`.

/** Feature id for Generate Query LLM mocking (matches `GENERATE_QUERY_MOCK_FEATURE`). */
const GENERATE_QUERY_FEATURE = 'generateQuery';

/** Routes exposed by the Generate Query mock catalogue. */
export type GenerateQueryMockRoute = 'returnsQuery' | 'returnsRefusal' | 'requestsSchemaSampling';

/**
 * Selects the Generate Query mock branch for the next generation. `delayMs`
 * stalls each request so a test can click Cancel mid-flight (works with any
 * route). Call BEFORE submitting a prompt.
 */
export function setGenerateQueryMock(route: GenerateQueryMockRoute, options?: { delayMs?: number }): void {
    setAiMock({ feature: GENERATE_QUERY_FEATURE, route, delayMs: options?.delayMs });
}
