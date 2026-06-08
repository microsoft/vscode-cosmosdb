/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cosmos DB emulator lifecycle helpers for the Playwright e2e suite.
 *
 * Used by:
 *   - `setup/globalSetup.ts` (start + wait + seed)
 *   - `setup/globalTeardown.ts` (stop)
 *
 * Why a separate emulator instance (8082/1235) instead of reusing the
 * developer's local one on 8081?
 *   - A developer can have `npm run docker-up` running while iterating —
 *     stopping their emulator from the test suite would be surprising.
 *   - Tests destroy + recreate the database, which would corrupt the
 *     developer's local seed.
 *   - Compose project name `cosmosdb-e2e` (passed via `-p`) keeps `up`/`down`
 *     scoped to our container only.
 *
 * Skip emulator entirely by setting `COSMOSDB_E2E_SKIP_EMULATOR=1` (useful for
 * pure-webview smoke tests that don't need a live backend).
 */

import { CosmosClient } from '@azure/cosmos';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import * as https from 'node:https';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

// ── Public constants ─────────────────────────────────────────────────────────
// Exported so the fixture / e2e commands can use the same values without
// hand-syncing them.

/** Compose project name — keeps `docker compose -p ...` scoped to e2e. */
export const E2E_COMPOSE_PROJECT = 'cosmosdb-e2e';

/** Host port mapped to the emulator's 8081 inside the container. */
export const E2E_EMULATOR_PORT = 8082;

/** Endpoint URL the e2e test suite (and the extension under test) uses. */
export const E2E_EMULATOR_ENDPOINT = `https://localhost:${E2E_EMULATOR_PORT}`;

/**
 * Well-known emulator master key — identical on every emulator installation.
 * Duplicated here from `src/cosmosdb/cosmosdb-shared-constants.ts` because
 * this file runs outside the extension's TS build. The constant cannot
 * change without breaking the emulator itself, so duplication is safe.
 */
export const E2E_EMULATOR_KEY =
    'C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw==';

/** Database created by the seed script — used by the e2e attach command. */
export const E2E_DATABASE_ID = 'nosql-test-db';

/** Container the smoke specs open in the QueryEditor by default. */
export const E2E_DEFAULT_CONTAINER_ID = 'products';

const COMPOSE_FILE = path.join(repoRoot, 'docker-compose.e2e.yml');
const SEED_SCRIPT = path.join(repoRoot, 'scripts', 'import-seed.mjs');

// ── Skip flag ────────────────────────────────────────────────────────────────

export function isEmulatorSkipped(): boolean {
    return process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1';
}

// ── Ownership marker ─────────────────────────────────────────────────────────
//
// A file written by `globalSetup` immediately after a successful `startEmulator()`
// and removed by `globalTeardown` after `stopEmulator()` returns. Lets teardown
// distinguish "we never got far enough to create a container" (no marker → skip
// `docker compose down` to avoid noise when Docker itself is unavailable) from
// "the container is ours, please clean it up".

const OWNERSHIP_MARKER = '.vscode-test/e2e-emulator.owned';

export function markEmulatorOwned(repoRoot: string): void {
    const markerPath = path.join(repoRoot, OWNERSHIP_MARKER);
    mkdirSync(path.dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, String(Date.now()), 'utf-8');
}

export function isEmulatorOwned(repoRoot: string): boolean {
    return existsSync(path.join(repoRoot, OWNERSHIP_MARKER));
}

export function clearEmulatorOwnership(repoRoot: string): void {
    const markerPath = path.join(repoRoot, OWNERSHIP_MARKER);
    if (existsSync(markerPath)) {
        rmSync(markerPath, { force: true });
    }
}

// ── Docker helpers ───────────────────────────────────────────────────────────

interface RunOptions {
    /** Forward child stdio to parent (otherwise inherited but quieter). */
    inherit?: boolean;
}

function runDockerCompose(args: string[], opts: RunOptions = {}): void {
    const fullArgs = ['compose', '-f', COMPOSE_FILE, '-p', E2E_COMPOSE_PROJECT, ...args];
    console.log(`[emulator] docker ${fullArgs.join(' ')}`);
    const result = spawnSync('docker', fullArgs, {
        stdio: opts.inherit === false ? 'pipe' : 'inherit',
        // Docker CLI is on PATH on every supported dev / CI image.
        shell: false,
    });
    if (result.error) {
        throw new Error(`Failed to invoke \`docker compose\`: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`\`docker ${fullArgs.join(' ')}\` exited with code ${result.status}`);
    }
}

/**
 * Brings the emulator up in detached mode. Idempotent: docker compose `up -d`
 * is a no-op when the container is already running.
 */
export function startEmulator(): void {
    if (!existsSync(COMPOSE_FILE)) {
        throw new Error(`docker-compose.e2e.yml not found at ${COMPOSE_FILE}`);
    }
    runDockerCompose(['up', '-d', '--remove-orphans']);
}

/**
 * Tears the emulator down and removes the container. `--volumes` is set
 * defensively even though the e2e compose file declares no named volumes —
 * keeps `docker volume ls` clean if someone ever adds one.
 */
export function stopEmulator(): void {
    runDockerCompose(['down', '--volumes', '--remove-orphans']);
}

// ── Readiness probe ──────────────────────────────────────────────────────────

const READY_TIMEOUT_MS = 180_000; // first cold start of vnext-preview can take ~90 s
const READY_POLL_INTERVAL_MS = 2_000;

/**
 * Polls the emulator with a real `getDatabaseAccount()` Cosmos SDK call
 * until it succeeds.
 *
 * Why not just GET `/_explorer/emulator.pem`? That endpoint is the old
 * Windows-emulator readiness signal; the linux/vnext-preview image
 * returns HTTP 400 there and only the Cosmos data-plane handshake is a
 * reliable "ready" signal.
 *
 * `enableEndpointDiscovery: false` is mandatory: the emulator advertises
 * its writable region as `https://127.0.0.1:8081` (the in-container port,
 * which we deliberately do NOT expose on the host), so the SDK would
 * otherwise immediately switch to it and get ECONNREFUSED. We always pin
 * to the endpoint we passed.
 *
 * The self-signed cert is trusted via a **scoped** `https.Agent` passed to
 * this single CosmosClient (mirrors `src/cosmosdb/getCosmosClient.ts` for
 * production emulator paths). Setting `NODE_TLS_REJECT_UNAUTHORIZED=0`
 * process-wide would disable cert validation for every HTTPS call in the
 * Node process — CodeQL flags it, and rightly so.
 */
export async function waitForEmulator(timeoutMs: number = READY_TIMEOUT_MS): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError: string = '(no probes yet)';

    // Single client reused across probes — avoids re-running TLS handshakes
    // on every poll. The scoped `agent` accepts the emulator's self-signed
    // cert without leaking that relaxation to any other HTTPS call.
    const client = new CosmosClient({
        endpoint: E2E_EMULATOR_ENDPOINT,
        key: E2E_EMULATOR_KEY,
        connectionPolicy: { enableEndpointDiscovery: false },
        agent: new https.Agent({ rejectUnauthorized: false }),
    });

    // Polling loop — awaits are sequential by design; we can't parallelize
    // a "wait until ready" probe.
    while (Date.now() < deadline) {
        try {
            // oxlint-disable-next-line no-await-in-loop
            await client.getDatabaseAccount();
            console.log(`[emulator] ready at ${E2E_EMULATOR_ENDPOINT}`);
            return;
        } catch (err) {
            const e = err as { code?: string; message?: string };
            lastError = e.code ?? e.message ?? String(err);
        }
        await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
    }

    throw new Error(
        `Cosmos DB emulator at ${E2E_EMULATOR_ENDPOINT} did not become ready within ${timeoutMs} ms (last probe: ${lastError})`,
    );
}

// ── Seed import ──────────────────────────────────────────────────────────────

/**
 * Runs `node scripts/import-seed.mjs --all --reset` against the e2e
 * emulator. `--reset` drops + recreates each container so we always start
 * the test suite from a known state. Uses `spawn` so the seed script's
 * progress output streams to the test log.
 */
export async function seedEmulator(): Promise<void> {
    if (!existsSync(SEED_SCRIPT)) {
        throw new Error(`Seed script not found at ${SEED_SCRIPT}`);
    }

    console.log('[emulator] seeding test data…');

    await new Promise<void>((resolve, reject) => {
        const child = spawn(
            process.execPath,
            [
                SEED_SCRIPT,
                '--all',
                '--reset',
                '--endpoint',
                E2E_EMULATOR_ENDPOINT,
                '--key',
                E2E_EMULATOR_KEY,
                '--database',
                E2E_DATABASE_ID,
            ],
            {
                stdio: 'inherit',
                // No NODE_TLS_REJECT_UNAUTHORIZED here — the seed script uses
                // a scoped https.Agent on its CosmosClient instead. Setting
                // it process-wide would disable cert validation for any
                // other HTTPS call the child makes (CodeQL js/disabling-
                // certificate-validation).
                env: process.env,
            },
        );
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`Seed import exited with code ${code}`));
        });
    });
}
