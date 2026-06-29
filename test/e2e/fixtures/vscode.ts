/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * Lint exceptions in this file (Playwright fixture conventions vs. React rules):
 *  - `react-hooks/rules-of-hooks`: triggers on `await use(...)` because the
 *    rule pattern-matches the identifier `use`. Here `use` is Playwright's
 *    fixture-consumer callback (see https://playwright.dev/docs/test-fixtures),
 *    not React 19's `use` hook.
 *  - `no-empty-pattern`: Playwright fixtures must accept a (possibly empty)
 *    destructuring of upstream fixtures as their first argument. `({}, use)`
 *    is the documented way to declare a fixture with no upstream deps.
 */

/* oxlint-disable react-hooks/rules-of-hooks, no-empty-pattern */

/**
 * Playwright fixtures for VS Code e2e tests. Adapted from the sibling
 * `vs-code-postgresql` repo's `fixtures/pgsqlExtension.ts`, simplified for
 * our single-editor (VS Code only) suite.
 *
 * Two fixtures, both **worker-scoped**:
 *
 *   - `vscodeApp`    — the launched `ElectronApplication`, reused across
 *                       every test in the worker
 *   - `vscodeWindow` — the main VS Code window as a Playwright `Page`,
 *                       reused across every test in the worker
 *
 * Worker-scoping matters: launching VS Code costs ~5 s. Per-test launch
 * means a 5-test file takes ~25 s of startup overhead; with worker scope
 * it's ~5 s total. The test author is responsible for resetting per-test
 * UI state via `afterEach` (see `closeAllEditorTabs` in webviewHelpers.ts).
 *
 * The fixture file deliberately does NOT auto-close tabs in an `afterEach`
 * here — fixtures with `afterEach` hooks are awkward to compose. Each spec
 * file should declare its own cleanup.
 */

import { test as base, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCapturePlan, shouldCapture } from '../helpers/captureMode';
import { ensureE2eIsolationContext } from '../helpers/e2eIsolation';
import { applyWindowLayout, DEFAULT_LAYOUT, type WindowLayout } from '../helpers/windowLayout';
import { waitForWorkbenchReady } from '../helpers/workbenchReady';
import { waitForExtensionsActivated } from '../setup/activation';
import { E2E_EMULATOR_PORT } from '../setup/emulator';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');

interface EmulatorConfig {
    endpoint: string;
    key: string;
    databaseId: string;
    defaultContainerId: string;
}

interface E2eConfig {
    vscodeExecutablePath: string;
    extensionDevelopmentPath: string;
    extensionsDir: string;
    /**
     * Absolute path of `test/e2e/fixtures/workspace/` — the source-of-truth
     * workspace folder. Each worker copies it into its own temp dir so
     * spec-side mutations don't leak across runs.
     */
    workspaceFixtureDir: string;
    /** Present unless `COSMOSDB_E2E_SKIP_EMULATOR=1` was set in globalSetup. */
    emulator?: EmulatorConfig;
}

function readE2eConfig(): E2eConfig {
    const configPath = path.resolve(repoRoot, '.vscode-test', 'e2e-config.json');
    return JSON.parse(readFileSync(configPath, 'utf-8')) as E2eConfig;
}

/**
 * Pre-seed `userDataDir/User/settings.json` with VS Code settings that
 * make the workbench cooperative with Playwright. Mirrors what the PG
 * project does; each setting is here for a specific flake we want to
 * pre-empt (see comments).
 */
function seedUserSettings(userDataDir: string): void {
    const settings: Record<string, unknown> = {
        // VS Code 1.112+ overlays a "sticky" container on tree headers that
        // intercepts pointer events — breaks hover/click on tree items.
        'workbench.tree.enableStickyScroll': false,
        // Preview tabs reuse the same tab as you click around, which makes
        // "open multiple files" flows brittle. Force every editor to be
        // a real tab.
        'workbench.editor.enablePreview': false,
        // Don't let VS Code re-open last session's untitled buffers — every
        // worker should start with an empty workbench.
        'files.hotExit': 'onExitAndWindowClose',
        // Chat / secondary sidebar can autopopup on fresh installs and steal
        // 30 % of horizontal space, hiding webview content.
        'workbench.secondarySideBar.visible': false,
        // Silence "do you trust this folder" — we already pass --disable-workspace-trust.
        'security.workspace.trust.enabled': false,
        // Cosmos DB emulator (linux/vnext-preview) advertises its writable
        // region as `https://127.0.0.1:8081`, which the host container
        // doesn't expose. With endpoint discovery enabled (the default),
        // the SDK would immediately reroute every request to the
        // unreachable port. Force the client to stay on whichever endpoint
        // the connection points at. Harmless for production single-region
        // accounts; required for any e2e-vs-emulator scenario.
        'cosmosDB.enableEndpointDiscovery': false,
        // The dedicated e2e emulator binds to 8082 (not the default 8081);
        // the migration provisioning step reads this to target the right port.
        'cosmosDB.emulator.port': E2E_EMULATOR_PORT,
    };
    const settingsPath = path.join(userDataDir, 'User', 'settings.json');
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 4), 'utf-8');
}

/**
 * Monkey-patch Electron's main-process `dialog` module so native
 * save / open / message dialogs never block the test. Untitled SQL editors,
 * unsaved changes on tab close, file pickers (e.g. the Query Editor Open
 * action), etc. would otherwise pop an OS dialog that Playwright cannot
 * interact with.
 */
async function disableNativeDialogs(app: ElectronApplication): Promise<void> {
    await app
        .evaluate(({ dialog }) => {
            dialog.showSaveDialog = () => Promise.resolve({ canceled: true, filePath: '' });
            dialog.showOpenDialog = () => Promise.resolve({ canceled: true, filePaths: [] });
            dialog.showMessageBoxSync = () => 1; // Typically "Don't Save"
            dialog.showMessageBox = () => Promise.resolve({ response: 1, checkboxChecked: false });
        })
        .catch(() => {
            /* Execution context may already be destroyed during teardown. */
        });
}

/** Best-effort recursive directory removal that never throws. */
function removeDirQuietly(dir: string): void {
    try {
        rmSync(dir, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
}

interface VsCodeFixtures {
    vscodeApp: ElectronApplication;
    vscodeWindow: Page;
}

interface VsCodeTestFixtures {
    /**
     * Test-scoped **option** controlling which VS Code chrome parts (primary
     * side bar, secondary side bar / Copilot Chat, bottom panel) are visible
     * for the test. Merged over {@link DEFAULT_LAYOUT} by the auto
     * `windowLayout` fixture (Copilot Chat + bottom panel hidden by default for
     * clean webview screenshots).
     *
     * Override per file / describe / test with `test.use()`:
     *
     *     test.use({ layout: { primarySideBar: false } });
     *
     * Keys are tri-state — a key you omit keeps its default; the defaults you
     * don't override stay in effect (the fixture merges them in). Applied
     * before each test body.
     */
    layout: WindowLayout;
    /**
     * Auto fixture (no value) that enforces the {@link VsCodeTestFixtures.layout}
     * option on the shared VS Code window before each test runs. See the
     * fixture body.
     */
    windowLayout: void;
    /**
     * Auto fixture (no value) that records a self-managed Playwright trace of
     * the VS Code window for the duration of each test when
     * `COSMOSDB_E2E_SCREENSHOT` selects a `trace` mode. See the fixture body.
     */
    windowTrace: void;
}

export const test = base.extend<VsCodeTestFixtures, VsCodeFixtures>({
    vscodeApp: [
        async ({}, use) => {
            const cfg = readE2eConfig();
            const isolation = ensureE2eIsolationContext();

            // Worker-scoped temp dirs under the run-scoped temp root.
            const workerDir = mkdtempSync(path.join(isolation.tempRootDir, 'worker-'));
            // VS Code creates a Unix domain socket at `<user-data-dir>/<ver>-main.sock`
            // during startup. POSIX caps socket paths at ~103 chars; the run-scoped
            // temp root (which can live under a long `TMPDIR`) easily pushes the socket
            // path past that limit, crashing VS Code's main process with
            // `listen EINVAL` before any window opens. Keep the user-data dir on a
            // short base on POSIX so the socket path stays within the limit. Windows
            // uses named pipes (no filesystem-path limit), so the original location
            // is fine there.
            const userDataDir =
                process.platform === 'win32' ? path.join(workerDir, 'user-data') : mkdtempSync('/tmp/cdbe2e-');
            const workspaceDir = path.join(workerDir, 'workspace');
            mkdirSync(userDataDir, { recursive: true });

            // Seed the workspace from the checked-in fixture so every spec
            // sees the same starting tree (.nosql samples, .vscode/settings.json,
            // etc.). Falls back to an empty dir if the fixture is missing —
            // keeps pure-shell smoke tests working even without the fixture
            // checked in.
            if (existsSync(cfg.workspaceFixtureDir)) {
                cpSync(cfg.workspaceFixtureDir, workspaceDir, { recursive: true });
            } else {
                mkdirSync(workspaceDir, { recursive: true });
            }

            // Per-worker scratch dir the migration AI mock reads (control.json)
            // and writes (capture.jsonl). Created up front so both the worker
            // (setMockControl) and the extension can see the same location.
            const migrationCaptureDir = path.join(workerDir, 'migration-capture');
            mkdirSync(migrationCaptureDir, { recursive: true });

            // Expose the per-worker workspace + capture dirs to this worker's
            // process.env. The migration fixtures (readGitignore, gitDirExists,
            // provisioningArtifact*, setMockControl) read these from the worker,
            // and the `...process.env` spread below forwards COSMOSDB_E2E_*
            // straight into the launched extension host (the AI mock reads the
            // capture dir there). Workers are isolated processes, so this never
            // leaks across workers.
            process.env.COSMOSDB_E2E_WORKSPACE_DIR = workspaceDir;
            process.env.COSMOSDB_E2E_MIGRATION_CAPTURE_DIR = migrationCaptureDir;

            seedUserSettings(userDataDir);

            const launchPromise = electron.launch({
                executablePath: cfg.vscodeExecutablePath,
                args: [
                    // Disable Electron's internal sandbox so Playwright's CDP attach
                    // works (mirrors what @vscode/test-electron does for headless runs).
                    '--no-sandbox',
                    // Skip first-run prompts that would block the window.
                    '--disable-workspace-trust',
                    '--skip-welcome',
                    '--skip-release-notes',
                    '--disable-telemetry',
                    '--disable-updates',
                    // Headless/CI envs without a real GPU surface — avoid GPU init crashes.
                    '--disable-gpu',
                    '--disable-gpu-sandbox',
                    // Force a new window so the launcher doesn't try to attach to a
                    // running instance (which would fail Playwright's CDP attach).
                    '--new-window',
                    `--user-data-dir=${userDataDir}`,
                    `--extensions-dir=${cfg.extensionsDir}`,
                    `--extensionDevelopmentPath=${cfg.extensionDevelopmentPath}`,
                    workspaceDir,
                ],
                env: {
                    ...(process.env as Record<string, string>),
                    // Silences telemetry warnings in the extension under test.
                    DEBUGTELEMETRY: 'v',
                    // Enables the `cosmosDB.e2e.*` test-only commands registered
                    // by `src/commands/e2eTestCommands/registerE2eTestCommands.ts`.
                    // Without this flag those commands are not registered at all,
                    // so production users running the extension never see them.
                    COSMOSDB_E2E_TEST: '1',
                    // Replaces the migration assistant's Copilot calls with a
                    // deterministic offline mock (see
                    // `src/panels/migration/helpers/e2eMigrationAiMock.ts`) so the
                    // full migration pipeline can run end-to-end without Copilot.
                    COSMOSDB_E2E_MIGRATION_AI_MOCK: '1',
                    // Source directory copied into `<workspace>/.cosmosdb-migration`
                    // by the `cosmosDB.e2e.openMigration` command so phase-flow
                    // specs start from a deterministic, pre-seeded project.
                    COSMOSDB_E2E_MIGRATION_SEED_DIR: path.resolve(here, 'migration-seed'),
                    // Emulator coordinates — read by the `cosmosDB.e2e.*` commands
                    // when building a `NoSqlQueryConnection` so QueryEditor /
                    // Document tabs open against the seeded e2e database. Absent
                    // when `COSMOSDB_E2E_SKIP_EMULATOR=1` was set.
                    ...(cfg.emulator
                        ? {
                              COSMOSDB_E2E_EMULATOR_ENDPOINT: cfg.emulator.endpoint,
                              COSMOSDB_E2E_EMULATOR_KEY: cfg.emulator.key,
                              COSMOSDB_E2E_DATABASE_ID: cfg.emulator.databaseId,
                              COSMOSDB_E2E_CONTAINER_ID: cfg.emulator.defaultContainerId,
                              // The cosmos SDK inside the extension hits the
                              // self-signed emulator endpoint; trust it for
                              // the test process only.
                              NODE_TLS_REJECT_UNAUTHORIZED: '0',
                          }
                        : {}),
                },
            });

            // `electron.launch` failures (startup crash, missing executable, …)
            // skip Playwright's fixture teardown, which would leak the POSIX
            // `userDataDir` under `/tmp` (it lives outside the run-scoped temp
            // root). Clean both dirs up on early failure before rethrowing.
            const app = await launchPromise.catch((err: unknown) => {
                removeDirQuietly(workerDir);
                removeDirQuietly(userDataDir);
                throw err;
            });

            await disableNativeDialogs(app);

            await use(app);

            // VS Code spawns helper processes (extension host, renderers,
            // utility) that keep the app alive, so `app.close()` reliably hangs
            // past the worker-teardown timeout. Every one of those processes
            // carries this worker's unique `--user-data-dir` in its argv, so a
            // targeted `pkill -f` tears the whole instance down without touching
            // other workers. Windows uses named pipes and closes cleanly, so
            // fall back to `app.close()` there.
            if (process.platform === 'win32') {
                await app.close().catch(() => {
                    /* close races with Electron teardown are expected */
                });
            } else {
                try {
                    execFileSync('pkill', ['-9', '-f', userDataDir]);
                } catch {
                    // `pkill` is missing or matched nothing. Fall back to killing
                    // the launched process directly so teardown can't hang on
                    // `app.close()` (VS Code keeps helper processes alive).
                    try {
                        app.process().kill('SIGKILL');
                    } catch {
                        /* already exited */
                    }
                }
                await app.close().catch(() => {
                    /* connection already dropped once the processes were killed */
                });
            }
            // Best-effort cleanup; on Windows file handles can linger briefly.
            removeDirQuietly(workerDir);
            // The POSIX user-data dir lives outside workerDir (short-path
            // workaround above), so remove it separately.
            if (userDataDir !== path.join(workerDir, 'user-data')) {
                removeDirQuietly(userDataDir);
            }
        },
        { scope: 'worker' },
    ],

    vscodeWindow: [
        async ({ vscodeApp }, use) => {
            const isolation = ensureE2eIsolationContext();

            // Race firstWindow() against an early "close" event so we get a
            // meaningful error if VS Code crashes during startup instead of
            // a generic timeout.
            const closeWatcher = vscodeApp.waitForEvent('close').then(() => {
                throw new Error('VS Code closed before a window became available.');
            });
            const page = await Promise.race([vscodeApp.firstWindow(), closeWatcher]);
            closeWatcher.catch(() => {
                /* swallow expected rejection on normal teardown */
            });

            await waitForWorkbenchReady(vscodeApp, page, isolation.resultsRootDir);

            // Pre-test activation handshake — reveals the Azure sidebar and
            // waits until our extension's workspace tree node appears. Cached
            // per worker (worker-scoped fixture), so the ~2-5 s cost is paid
            // exactly once even with dozens of specs. See activation.ts for
            // the full rationale.
            await waitForExtensionsActivated(page);

            await use(page);
        },
        { scope: 'worker' },
    ],

    // Test-scoped option: per-test window-layout overrides, merged over
    // DEFAULT_LAYOUT by the `windowLayout` fixture. `test.use({ layout })`
    // *replaces* this value (it doesn't deep-merge), so it defaults to `{}`
    // and the defaults are applied in the fixture — that keeps a partial
    // override like `{ primarySideBar: false }` additive over the defaults.
    layout: [{}, { option: true }],

    windowLayout: [
        async ({ vscodeWindow, layout }, use) => {
            // Enforce the requested layout on the shared (worker-scoped) window
            // before the test body runs, so prior tests can't leak chrome state
            // (an opened side bar / panel) into this one. Merge over the
            // defaults so a partial override only changes the parts it names.
            // Best-effort — the helper never throws on a layout tweak.
            if (!vscodeWindow.isClosed()) {
                await applyWindowLayout(vscodeWindow, { ...DEFAULT_LAYOUT, ...layout });
            }
            await use();
        },
        // `auto` so every test gets the layout without opting in; declared
        // before `windowTrace` so the window has settled before tracing starts.
        { auto: true },
    ],

    windowTrace: [
        async ({ vscodeApp, vscodeWindow }, use, testInfo) => {
            const { trace } = resolveCapturePlan();
            // `vscodeWindow` is depended on so the workbench is ready before
            // tracing starts (and so this auto fixture is ordered after window
            // setup); skip if it never came up.
            if (trace === 'off' || vscodeWindow.isClosed()) {
                await use();
                return;
            }

            const context = vscodeApp.context();

            // Own the trace where possible so `screenshots: true` is forced —
            // that's what produces the filmstrip the runner can't capture for a
            // manually `_electron.launch`-ed window. `snapshots` is deliberately
            // OFF: the trace viewer's DOM-snapshot reconstruction can't reproduce
            // VS Code's canvas-painted shell or its cross-origin webview iframes,
            // so it renders a misleading, stripped-down approximation. Without
            // snapshots the viewer falls back to the real screencast frames, and
            // the trace stays smaller. If the runner already has tracing active
            // on this context (e.g. on a retry), record this test's slice as a
            // chunk of that existing session instead.
            let owns = false;
            try {
                await context.tracing.start({ screenshots: true, snapshots: false, sources: true });
                owns = true;
            } catch {
                try {
                    await context.tracing.startChunk({ title: testInfo.title });
                } catch {
                    // Tracing unavailable — run the test without a window trace.
                    await use();
                    return;
                }
            }

            await use();

            const keep = shouldCapture(trace, testInfo.status !== testInfo.expectedStatus);
            const file = testInfo.outputPath('vscode-window-trace.zip');
            try {
                if (owns) {
                    await context.tracing.stop(keep ? { path: file } : undefined);
                } else {
                    await context.tracing.stopChunk(keep ? { path: file } : undefined);
                }
                if (keep) {
                    // The attachment MUST be named `trace` (with the
                    // `application/zip` content type): that's the only name the
                    // Playwright HTML report / UI special-cases into an embedded
                    // "open trace" link that launches the trace viewer in-page.
                    // Any other name renders as a plain download, and the OS then
                    // fails to open the raw zip ("unsupported format").
                    await testInfo.attach('trace', { path: file, contentType: 'application/zip' });
                }
            } catch {
                // Best-effort — never fail a test on trace capture/teardown.
            }
        },
        { auto: true },
    ],
});

export { expect } from '@playwright/test';
