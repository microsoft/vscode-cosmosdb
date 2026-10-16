/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Captures Skill dispatches for Playwright tests without opening a real Copilot Chat session.
 * The test fixtures simulate agent execution by writing portable migration artifacts.
 *
 * Visibility / safety
 * -------------------
 *  - Active ONLY when both `COSMOSDB_E2E_TEST === '1'` and
 *    `COSMOSDB_E2E_MIGRATION_AI_MOCK === '1'` (set by the Playwright fixture in
 *    `test/e2e/fixtures/vscode.ts`).
 *  - Production users never set these env vars, so the mock is never wired in.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import * as path from 'node:path';

const E2E_TEST_ENV_KEY = 'COSMOSDB_E2E_TEST';
/** When set, every mock request appends `{route, promptText}` to capture.jsonl. */
const CAPTURE_DIR_ENV_KEY = 'COSMOSDB_E2E_MIGRATION_CAPTURE_DIR';
const MIGRATION_AI_MOCK_ENV_KEY = 'COSMOSDB_E2E_MIGRATION_AI_MOCK';

/**
 * `true` when the migration AI mock should be wired in. Requires the master
 * e2e flag as well so the mock can never leak into a normal session.
 */
export function isMigrationAiMockEnabled(): boolean {
    return process.env[E2E_TEST_ENV_KEY] === '1' && process.env[MIGRATION_AI_MOCK_ENV_KEY] === '1';
}

/**
 * Best-effort, test-only sink: appends each request's route + flattened prompt
 * text to `capture.jsonl` in {@link CAPTURE_DIR_ENV_KEY}. Lets e2e tests assert
 * that the requested phase and model reach the Skill dispatch.
 */
export function capturePrompt(
    route: string | undefined,
    promptText: string,
    chat?: { newSession: boolean; modelSelector: { vendor: string; id: string } },
): void {
    const dir = process.env[CAPTURE_DIR_ENV_KEY];
    if (!dir) {
        return;
    }
    try {
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        appendFileSync(
            path.join(dir, 'capture.jsonl'),
            JSON.stringify({ route: route ?? null, promptText, chat }) + '\n',
        );
    } catch {
        // Capture is diagnostic-only; never let it break the mock.
    }
}
