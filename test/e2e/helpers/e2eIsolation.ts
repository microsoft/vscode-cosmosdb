/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Per-run isolation context for e2e tests.
 *
 * Adapted (and simplified) from the pattern used in the sibling
 * `vs-code-postgresql` repo. Goals:
 *
 *  - Every `playwright test` invocation gets a unique `runId` so parallel
 *    runs on the same machine don't collide on temp/results dirs.
 *  - All side-effect locations (user-data dir, extensions dir, results,
 *    HTML report) hang off this single object — no scattered `path.join`
 *    calls across the suite.
 *  - Every key is environment-overridable so CI can pin paths or reuse
 *    them across teardown.
 *
 * Called from `playwright.config.ts` (module load time), `globalSetup.ts`,
 * `globalTeardown.ts`, and the per-worker fixture.
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const RUN_ID_ENV = 'COSMOSDB_E2E_RUN_ID';
const TEMP_ROOT_ENV = 'COSMOSDB_E2E_TEMP_ROOT';
const RESULTS_ROOT_ENV = 'COSMOSDB_E2E_RESULTS_ROOT';
const REPORTS_ROOT_ENV = 'COSMOSDB_E2E_REPORTS_ROOT';

export interface E2eIsolationContext {
    /** Sortable run token, `YYYYMMDD-HHMMSS-xxxx` by default (env-overridable). */
    readonly runId: string;
    /** Root for everything ephemeral — user-data dirs, workspace dirs, etc. */
    readonly tempRootDir: string;
    /** Playwright `outputDir` — per-test artefacts (videos, traces, screenshots). */
    readonly resultsRootDir: string;
    /** HTML report directory and any aggregated reporter outputs. */
    readonly reportsRootDir: string;
}

function sanitize(value: string | undefined, fallback: string): string {
    const trimmed = value
        ?.trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
    return trimmed && trimmed.length > 0 ? trimmed.slice(0, 16) : fallback;
}

function resolveRunId(): string {
    const fromEnv = sanitize(process.env[RUN_ID_ENV], '');
    if (fromEnv) {
        process.env[RUN_ID_ENV] = fromEnv;
        return fromEnv;
    }
    // Default to a sortable timestamp so `.results` / `.reports` list in
    // chronological order; a short random suffix keeps two runs started in the
    // same second from colliding.
    const generated = `${timestampToken()}-${randomBytes(2).toString('hex')}`;
    process.env[RUN_ID_ENV] = generated;
    return generated;
}

/** Compact, filesystem- and sort-friendly local timestamp: `YYYYMMDD-HHMMSS`. */
function timestampToken(): string {
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, '0');
    return (
        `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
        `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    );
}

/**
 * Resolves the isolation context (creating directories on first call) and
 * caches the result on `globalThis` so every module that imports this file
 * sees the same paths within a single `playwright test` invocation.
 */
export function ensureE2eIsolationContext(): E2eIsolationContext {
    const runId = resolveRunId();
    const tempRootDir = process.env[TEMP_ROOT_ENV] ?? path.join(os.tmpdir(), `cosmosdb-e2e-${runId}`);
    const resultsRootDir =
        process.env[RESULTS_ROOT_ENV] ?? path.resolve(process.cwd(), 'test', 'e2e', '.results', runId);
    const reportsRootDir =
        process.env[REPORTS_ROOT_ENV] ?? path.resolve(process.cwd(), 'test', 'e2e', '.reports', runId);

    process.env[TEMP_ROOT_ENV] = tempRootDir;
    process.env[RESULTS_ROOT_ENV] = resultsRootDir;
    process.env[REPORTS_ROOT_ENV] = reportsRootDir;

    for (const dir of [tempRootDir, resultsRootDir, reportsRootDir]) {
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    return { runId, tempRootDir, resultsRootDir, reportsRootDir };
}
