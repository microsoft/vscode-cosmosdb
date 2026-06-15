/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Playwright globalSetup: prepares everything the worker fixture needs.
 *
 * Runs once per `playwright test` invocation, before any worker spawns. Side
 * effects:
 *
 *   1. Ensures the extension build (`dist/`) is **fresh** relative to the
 *      sources it was produced from. Mtimes of `package.json` + `src/`
 *      are compared against `dist/main.mjs` and `dist/package.json`; if any
 *      source is newer, `npm run vite-prod` is invoked automatically.
 *      Override with `COSMOSDB_E2E_SKIP_BUILD=1` (useful when you're
 *      iterating on tests only).
 *   2. Downloads/locates a stable VS Code via `@vscode/test-electron`
 *      (cached under `.vscode-test/`).
 *   3. Installs the extension's runtime dependencies (currently just
 *      `ms-azuretools.vscode-azureresourcegroups`) into a dedicated
 *      extensions directory. Required because our extension declares
 *      `extensionDependencies` and VS Code refuses to activate it otherwise.
 *      Cached: a marker file under `.vscode-test/e2e-extensions/.installed`
 *      lists the extension IDs already provisioned.
 *   4. Brings the Cosmos DB emulator up via docker compose (separate compose
 *      file `docker-compose.e2e.yml` on ports 8082/1235, so the developer's
 *      local emulator on 8081 is unaffected), waits for readiness, and
 *      seeds the test database. Skip with `COSMOSDB_E2E_SKIP_EMULATOR=1`.
 *   5. Writes the resolved paths + emulator config to
 *      `.vscode-test/e2e-config.json` for the test fixture to consume
 *      (no env-var pollution between workers).
 */

import { downloadAndUnzipVSCode, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { spawnSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    readdirSync,
    readFileSync,
    realpathSync,
    statSync,
    writeFileSync,
    type Dirent,
} from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    E2E_DATABASE_ID,
    E2E_DEFAULT_CONTAINER_ID,
    E2E_EMULATOR_ENDPOINT,
    E2E_EMULATOR_KEY,
    isEmulatorSkipped,
    markEmulatorOwned,
    seedEmulator,
    startEmulator,
    waitForEmulator,
} from './emulator';

const REQUIRED_EXTENSIONS = ['ms-azuretools.vscode-azureresourcegroups'];
const VSCODE_VERSION = 'stable';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

/**
 * Returns the most recent mtime (ms since epoch) under `dir`, recursing into
 * subdirectories. Skips a few well-known build/output trees so we don't
 * accidentally pull mtimes from generated files.
 */
function maxMtimeMs(dir: string): number {
    let max = 0;
    const SKIP = new Set(['node_modules', 'dist', 'out', '.vscode-test', '.git']);
    const stack: string[] = [dir];
    while (stack.length > 0) {
        const current = stack.pop()!;
        let entries: Dirent[];
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const e of entries) {
            if (SKIP.has(e.name)) continue;
            const full = path.join(current, e.name);
            if (e.isDirectory()) {
                stack.push(full);
            } else if (e.isFile()) {
                try {
                    const m = statSync(full).mtimeMs;
                    if (m > max) max = m;
                } catch {
                    // file vanished mid-walk — ignore
                }
            }
        }
    }
    return max;
}

/**
 * Heuristic: dist is stale if any of (root package.json, anything under src/)
 * has an mtime newer than the dist's main.mjs OR dist's package.json. Either
 * staleness condition triggers a rebuild — the bundler copies package.json
 * into dist, so a mismatched manifest is the very symptom that prompted us
 * to add this check (VS Code complains about menu items referencing
 * commands that aren't in the stale dist/package.json).
 */
function isDistStale(extensionDevelopmentPath: string): { stale: boolean; reason: string } {
    const mainMjs = path.join(extensionDevelopmentPath, 'main.mjs');
    const distPkg = path.join(extensionDevelopmentPath, 'package.json');
    if (!existsSync(mainMjs) || !existsSync(distPkg)) {
        return { stale: true, reason: 'dist/ missing' };
    }
    const distMin = Math.min(statSync(mainMjs).mtimeMs, statSync(distPkg).mtimeMs);
    const rootPkgMs = statSync(path.resolve(repoRoot, 'package.json')).mtimeMs;
    if (rootPkgMs > distMin) {
        return { stale: true, reason: 'root package.json newer than dist/' };
    }
    const srcMax = maxMtimeMs(path.resolve(repoRoot, 'src'));
    if (srcMax > distMin) {
        return { stale: true, reason: 'src/ has files newer than dist/' };
    }
    return { stale: false, reason: '' };
}

function runVitePod(): void {
    console.log('[e2e setup] Running `npm run vite-prod` (this can take ~30–60 s)…');
    const result = spawnSync('npm', ['run', 'vite-prod'], {
        cwd: repoRoot,
        stdio: 'inherit',
        // Required on Windows where `npm` resolves to a .cmd shim.
        shell: process.platform === 'win32',
    });
    if (result.status !== 0) {
        throw new Error(`\`npm run vite-prod\` exited with code ${result.status}`);
    }
}

export default async function globalSetup(): Promise<void> {
    // 1. Ensure the extension build is fresh — auto-rebuild if stale.
    const extensionDevelopmentPath = path.resolve(repoRoot, 'dist');
    if (process.env.COSMOSDB_E2E_SKIP_BUILD === '1') {
        if (!existsSync(path.join(extensionDevelopmentPath, 'main.mjs'))) {
            throw new Error(
                'COSMOSDB_E2E_SKIP_BUILD=1 but dist/main.mjs does not exist. Run `npm run vite-prod` first.',
            );
        }
        console.log('[e2e setup] COSMOSDB_E2E_SKIP_BUILD=1 — using whatever is in dist/ as-is');
    } else {
        const { stale, reason } = isDistStale(extensionDevelopmentPath);
        if (stale) {
            console.log(`[e2e setup] dist/ is stale (${reason}) — rebuilding…`);
            runVitePod();
        } else {
            console.log('[e2e setup] dist/ is up to date');
        }
    }

    // 2. Download VS Code (cached by @vscode/test-electron under .vscode-test/).
    console.log(`[e2e setup] Resolving VS Code (${VSCODE_VERSION})…`);
    const vscodeExecutablePath = await downloadAndUnzipVSCode(VSCODE_VERSION);

    // 3. Install dependent extensions into a dedicated, cached extensions dir.
    const extensionsDir = path.resolve(repoRoot, '.vscode-test', 'e2e-extensions');
    mkdirSync(extensionsDir, { recursive: true });
    const installedMarker = path.join(extensionsDir, '.installed');
    const alreadyInstalled = existsSync(installedMarker)
        ? new Set(readFileSync(installedMarker, 'utf-8').split('\n').filter(Boolean))
        : new Set<string>();

    const toInstall = REQUIRED_EXTENSIONS.filter((id) => !alreadyInstalled.has(id));
    if (toInstall.length > 0) {
        const [cli, ...baseArgs] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
        for (const id of toInstall) {
            console.log(`[e2e setup] Installing dependent extension: ${id}`);
            const result = spawnSync(cli, [...baseArgs, '--extensions-dir', extensionsDir, '--install-extension', id], {
                encoding: 'utf-8',
                stdio: 'inherit',
                // Required on Windows when `cli` resolves to a .cmd / .bat.
                shell: process.platform === 'win32',
            });
            if (result.status !== 0) {
                throw new Error(
                    `Failed to install ${id} (exit code ${result.status}${
                        result.error ? `, error: ${result.error.message}` : ''
                    })`,
                );
            }
            alreadyInstalled.add(id);
        }
        writeFileSync(installedMarker, [...alreadyInstalled].join('\n'), 'utf-8');
    }

    // 4. Cosmos DB emulator — separate compose project so we don't fight
    //    the developer's local `npm run docker-up`. Skip when the suite
    //    only needs the webview shell (smoke / UI-only specs).
    let emulator:
        | undefined
        | {
              endpoint: string;
              key: string;
              databaseId: string;
              defaultContainerId: string;
          };
    if (isEmulatorSkipped()) {
        console.log('[e2e setup] COSMOSDB_E2E_SKIP_EMULATOR=1 — skipping emulator startup + seed');
    } else {
        console.log('[e2e setup] Starting Cosmos DB emulator (docker-compose.e2e.yml)…');
        startEmulator();
        // Mark the emulator as in-flight BEFORE the readiness probe / seed
        // so a Ctrl-C between startEmulator() and waitForEmulator() still
        // lets teardown clean up the container we just created.
        markEmulatorOwned(repoRoot);
        await waitForEmulator();
        await seedEmulator();
        emulator = {
            endpoint: E2E_EMULATOR_ENDPOINT,
            key: E2E_EMULATOR_KEY,
            databaseId: E2E_DATABASE_ID,
            defaultContainerId: E2E_DEFAULT_CONTAINER_ID,
        };
    }

    // 5. Persist resolved paths for the per-test fixture.
    // realpathSync.native to normalize Windows drive-letter casing (matches what
    // run-integration-tests.mjs does — same ESM module-cache concern).
    const config = {
        vscodeExecutablePath: realpathSync.native(vscodeExecutablePath),
        extensionDevelopmentPath: realpathSync.native(extensionDevelopmentPath),
        extensionsDir: realpathSync.native(extensionsDir),
        // Source-of-truth workspace fixture (`test/e2e/fixtures/workspace/`).
        // The vscode.ts fixture copies it into each worker's temp dir before
        // launching VS Code.
        workspaceFixtureDir: realpathSync.native(path.resolve(repoRoot, 'test', 'e2e', 'fixtures', 'workspace')),
        emulator,
    };
    const configPath = path.resolve(repoRoot, '.vscode-test', 'e2e-config.json');
    writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log(`[e2e setup] Config written to ${configPath}`);
}
