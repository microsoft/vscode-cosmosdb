/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Test-only commands that open the QueryEditor / Document webview panels
 * and seed the workspace storage without going through the usual
 * `pickAppResource` quick-pick prompts.
 *
 * Why this exists
 * ---------------
 * The production commands (`cosmosDB.openNoSqlQueryEditor`, `cosmosDB.openDocument`)
 * require either a tree-view node or a live Cosmos DB connection. Playwright e2e
 * tests have neither: they launch a fresh VS Code with no accounts attached.
 * Without a way to render the panels directly, we'd have to drive the entire
 * account-creation → tree-expansion → context-menu flow for every smoke test —
 * slow and brittle.
 *
 * These commands sidestep that by calling `QueryEditorTab.render()` /
 * `DocumentTab.render()` directly with a `NoSqlQueryConnection` built from
 * the emulator coordinates the Playwright fixture exports via env vars:
 *
 *   COSMOSDB_E2E_EMULATOR_ENDPOINT   e.g. https://localhost:8082
 *   COSMOSDB_E2E_EMULATOR_KEY        well-known emulator key
 *   COSMOSDB_E2E_DATABASE_ID         seeded by scripts/import-seed.mjs
 *   COSMOSDB_E2E_CONTAINER_ID        default container the smoke spec opens
 *
 * When the emulator env vars are absent (e.g. `COSMOSDB_E2E_SKIP_EMULATOR=1`),
 * the QueryEditor opens in disconnected state — enough to mount the React
 * tree for pure-webview smoke tests.
 *
 * Visibility / safety
 * -------------------
 *  - Registered only when `process.env.COSMOSDB_E2E_TEST === '1'` (set by the
 *    Playwright fixture in `test/e2e/fixtures/vscode.ts`).
 *  - The matching context key `cosmosDB.e2eTestMode` is set to `true` so the
 *    palette entries (declared in `package.json#menus.commandPalette` with
 *    `when: 'cosmosDB.e2eTestMode'`) are visible **only** while the flag is set.
 *  - Production users running the extension never enable the flag → the
 *    commands are not registered at all, not invokable, and not discoverable.
 */

import { registerCommand, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as path from 'path';
import * as vscode from 'vscode';
import { API } from '../../AzureDBExperiences';
import { AuthenticationMethod } from '../../cosmosdb/AuthenticationMethod';
import { type CosmosDBCredential } from '../../cosmosdb/CosmosDBCredential';
import { type NoSqlQueryConnection } from '../../cosmosdb/NoSqlQueryConnection';
import { ext } from '../../extensionVariables';
import { DocumentTab } from '../../panels/DocumentTab';
import { MigrationAssistantTab } from '../../panels/MigrationAssistantTab';
import { QueryEditorTab } from '../../panels/QueryEditorTab';
import { MIGRATION_FOLDER } from '../../services/MigrationProjectService';
import { StorageNames, StorageService, type StorageItem } from '../../services/StorageService';
import { WorkspaceResourceType } from '../../tree/workspace-api/SharedWorkspaceResourceProvider';
import { setE2eModelOverride, type AvailableModelDescriptor } from '../../utils/aiUtils';
import { getEmulatorItemUniqueId } from '../../utils/emulatorUtils';
import { setE2eGenerateQueryRoute } from './generateQueryMockModel';

const E2E_TEST_ENV_KEY = 'COSMOSDB_E2E_TEST';
const E2E_TEST_CONTEXT_KEY = 'cosmosDB.e2eTestMode';

// Emulator coordinates injected by the Playwright fixture
// (`test/e2e/fixtures/vscode.ts`). All four are required to build a
// real `NoSqlQueryConnection`; if any is missing we fall back to a
// disconnected open.
const ENV_EMULATOR_ENDPOINT = 'COSMOSDB_E2E_EMULATOR_ENDPOINT';
const ENV_EMULATOR_KEY = 'COSMOSDB_E2E_EMULATOR_KEY';
const ENV_DATABASE_ID = 'COSMOSDB_E2E_DATABASE_ID';
const ENV_CONTAINER_ID = 'COSMOSDB_E2E_CONTAINER_ID';

/**
 * Deterministic fake Copilot models used by `cosmosDB.e2e.setMockLanguageModels`.
 * Two entries (>1) so the Generate Query input renders the model-switcher
 * `Combobox` rather than the single-model static label. Names are referenced
 * verbatim by `test/e2e/specs/generate-query-input.spec.ts`.
 */
const E2E_MOCK_MODELS: readonly AvailableModelDescriptor[] = [
    { id: 'e2e-mock-gpt-4o', name: 'Mock GPT-4o', family: 'gpt-4o', vendor: 'copilot', maxInputTokens: 128_000 },
    {
        id: 'e2e-mock-gpt-4o-mini',
        name: 'Mock GPT-4o mini',
        family: 'gpt-4o-mini',
        vendor: 'copilot',
        maxInputTokens: 128_000,
    },
];

// Absolute path of a fixture directory copied into `<workspace>/.cosmosdb-migration`
// by `cosmosDB.e2e.openMigration`. Set by the Playwright fixture so the command
// stays palette-invokable without arguments.
const ENV_MIGRATION_SEED_DIR = 'COSMOSDB_E2E_MIGRATION_SEED_DIR';

export function isE2eTestModeEnabled(): boolean {
    return process.env[E2E_TEST_ENV_KEY] === '1';
}

interface EmulatorEnv {
    endpoint: string;
    key: string;
    databaseId: string;
    containerId: string;
}

/**
 * Reads emulator coordinates from env. Returns undefined if any are missing
 * — caller should fall back to disconnected mode.
 *
 * Accepts optional overrides from `args` (the first command-invocation arg)
 * so specs can target other databases/containers without re-launching VS
 * Code. Env vars supply the defaults.
 */
function readEmulatorEnv(args?: Partial<EmulatorEnv>): EmulatorEnv | undefined {
    const endpoint = args?.endpoint ?? process.env[ENV_EMULATOR_ENDPOINT];
    const key = args?.key ?? process.env[ENV_EMULATOR_KEY];
    const databaseId = args?.databaseId ?? process.env[ENV_DATABASE_ID];
    const containerId = args?.containerId ?? process.env[ENV_CONTAINER_ID];
    if (!endpoint || !key || !databaseId || !containerId) return undefined;
    return { endpoint, key, databaseId, containerId };
}

function buildEmulatorConnection(env: EmulatorEnv): NoSqlQueryConnection {
    const credentials: CosmosDBCredential[] = [{ type: AuthenticationMethod.accountKey, key: env.key }];
    return {
        databaseId: env.databaseId,
        containerId: env.containerId,
        endpoint: env.endpoint,
        credentials,
        isEmulator: true,
    };
}

function buildEmulatorConnectionString(env: EmulatorEnv): string {
    // Trailing slash matches the format used by `LocalCoreEmulatorsItem.ts`
    // and the production "New Emulator Connection" wizard.
    const normalized = env.endpoint.endsWith('/') ? env.endpoint : `${env.endpoint}/`;
    return `AccountEndpoint=${normalized};AccountKey=${env.key};`;
}

/**
 * Pushes an entry into the workspace `AttachedAccounts` storage so the
 * Cosmos DB Workspaces tree shows the e2e emulator without going through the
 * "Attach Database Account" wizard. The id is the same content-hash the
 * production flow uses (`getEmulatorItemUniqueId`), so re-running this
 * command is idempotent.
 */
async function attachEmulatorAccount(env: EmulatorEnv): Promise<void> {
    const connectionString = buildEmulatorConnectionString(env);
    const item: StorageItem = {
        id: getEmulatorItemUniqueId(connectionString),
        name: `E2E Emulator (${env.databaseId})`,
        properties: {
            api: API.Core,
            isEmulator: true,
        },
        secrets: [connectionString],
    };
    await StorageService.get(StorageNames.Workspace).push(WorkspaceResourceType.AttachedAccounts, item, true);
}

/**
 * Deletes `<workspace>/.cosmosdb-migration` so each migration spec starts from a
 * clean slate. The seed copy (when a fresh project is needed) is performed
 * separately by {@link seedMigrationProject}. Best-effort: a missing folder is
 * ignored, which keeps the command idempotent.
 */
async function resetMigrationFolder(workspacePath: string): Promise<void> {
    const target = vscode.Uri.file(path.join(workspacePath, MIGRATION_FOLDER));
    try {
        await vscode.workspace.fs.delete(target, { recursive: true, useTrash: false });
    } catch {
        // Target may not exist yet — ignore.
    }
}

/**
 * Copies a seed project directory into `<workspace>/.cosmosdb-migration` so
 * specs can drive deterministic "loaded project" and full phase-flow scenarios
 * without the native file-picker dialogs the production flow uses. The seed
 * source is read from `COSMOSDB_E2E_MIGRATION_SEED_DIR` (set by the Playwright
 * fixture) so the command stays palette-invokable (no args required).
 */
async function seedMigrationProject(workspacePath: string): Promise<boolean> {
    const seedFrom = process.env[ENV_MIGRATION_SEED_DIR];
    if (!seedFrom) return false;
    const target = vscode.Uri.file(path.join(workspacePath, MIGRATION_FOLDER));
    await vscode.workspace.fs.copy(vscode.Uri.file(seedFrom), target, { overwrite: true });
    return true;
}

function resolveWorkspacePath(): string {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) {
        throw new Error('cosmosDB.e2e.openMigration requires an open workspace folder.');
    }
    return workspacePath;
}

/**
 * Stubs the workspace's version-control state for migration specs: when
 * `present`, creates an empty `.git/` dir (enough for the file-based
 * `hasGitRepository()` check) so the "exclude from version control" control
 * renders; when absent, removes it so the missing-VCS warning renders. Always
 * resets `.gitignore` so the exclude checkbox starts unchecked.
 */
async function setGitPresent(workspacePath: string, present: boolean): Promise<void> {
    const gitDir = vscode.Uri.file(path.join(workspacePath, '.git'));
    const gitignore = vscode.Uri.file(path.join(workspacePath, '.gitignore'));
    try {
        await vscode.workspace.fs.delete(gitignore, { useTrash: false });
    } catch {
        // No .gitignore yet — fine.
    }
    if (present) {
        await vscode.workspace.fs.createDirectory(gitDir);
    } else {
        try {
            await vscode.workspace.fs.delete(gitDir, { recursive: true, useTrash: false });
        } catch {
            // No .git yet — fine.
        }
    }
}

/**
 * Registers the e2e-test commands and sets the `cosmosDB.e2eTestMode` context
 * key. Safe to call unconditionally — exits early if the env flag is unset.
 *
 * Must be called from `extension.ts` activation, AFTER `registerCommands()`
 * so we don't shadow any production command IDs.
 */
export function registerE2eTestCommands(): void {
    if (!isE2eTestModeEnabled()) return;

    // The `when` clauses in package.json menus look for this context key.
    void vscode.commands.executeCommand('setContext', E2E_TEST_CONTEXT_KEY, true);

    // Opens the Migration Assistant against a deterministic, pre-seeded project
    // (consent granted + application analysis populated + schema files present)
    // so phase-flow specs can drive Discovery → Assessment → Conversion without
    // the native file pickers. Always resets `.cosmosdb-migration` first so the
    // command is hermetic regardless of prior-test state.
    registerCommand('cosmosDB.e2e.openMigration', async (context: IActionContext): Promise<void> => {
        context.telemetry.properties.isE2eTest = 'true';
        const workspacePath = resolveWorkspacePath();
        await resetMigrationFolder(workspacePath);
        // Version control present is the default scenario: seed a `.git` dir so
        // the "exclude from version control" control renders, with a clean
        // .gitignore so the exclude checkbox starts unchecked.
        await setGitPresent(workspacePath, true);
        context.telemetry.properties.seeded = String(await seedMigrationProject(workspacePath));
        MigrationAssistantTab.render(workspacePath);
    });

    // Opens the Migration Assistant against a fresh, empty project (no consent,
    // no analysis) so specs can assert the initial disabled-control state.
    registerCommand('cosmosDB.e2e.openMigrationFresh', async (context: IActionContext): Promise<void> => {
        context.telemetry.properties.isE2eTest = 'true';
        const workspacePath = resolveWorkspacePath();
        await resetMigrationFolder(workspacePath);
        // No version control: drop `.git` so the missing-VCS warning renders.
        await setGitPresent(workspacePath, false);
        MigrationAssistantTab.render(workspacePath);
    });

    registerCommand('cosmosDB.e2e.openQueryEditor', (context: IActionContext, args?: Partial<EmulatorEnv>): void => {
        context.telemetry.properties.isE2eTest = 'true';
        const env = readEmulatorEnv(args);
        const connection = env ? buildEmulatorConnection(env) : undefined;
        context.telemetry.properties.hasConnection = connection ? 'true' : 'false';
        // No connection → opens in disconnected state, which is enough
        // to mount the React tree for pure-webview smoke tests.
        QueryEditorTab.render(connection);
    });

    registerCommand('cosmosDB.e2e.openDocument', (context: IActionContext, args?: Partial<EmulatorEnv>): void => {
        context.telemetry.properties.isE2eTest = 'true';
        const env = readEmulatorEnv(args);
        // No env → render with a stub disconnected connection so the
        // panel mounts. Network calls will fail through the existing
        // error-toast pipeline.
        const connection: NoSqlQueryConnection = env
            ? buildEmulatorConnection(env)
            : {
                  databaseId: 'e2e-test-db',
                  containerId: 'e2e-test-container',
                  endpoint: 'https://localhost:0',
                  credentials: [],
                  isEmulator: true,
              };
        context.telemetry.properties.hasConnection = env ? 'true' : 'false';
        DocumentTab.render(connection, 'add');
    });

    registerCommand(
        'cosmosDB.e2e.attachEmulator',
        async (context: IActionContext, args?: Partial<EmulatorEnv>): Promise<void> => {
            context.telemetry.properties.isE2eTest = 'true';
            const env = readEmulatorEnv(args);
            if (!env) {
                throw new Error(
                    `cosmosDB.e2e.attachEmulator requires emulator env vars (${ENV_EMULATOR_ENDPOINT}, ${ENV_EMULATOR_KEY}, ${ENV_DATABASE_ID}, ${ENV_CONTAINER_ID}) or an args override.`,
                );
            }
            await attachEmulatorAccount(env);
        },
    );

    // Forces the AI-features flag on (or off) so specs can assert on the
    // AI button without depending on a real Copilot/chat installation in the
    // test VS Code. Setting `ext.isAIFeaturesEnabled` before opening the
    // Query Editor makes the initial webview state report AI as enabled; the
    // `notifyAIFeaturesChanged` broadcast also updates any already-open tabs.
    // Invoked from the palette with no arg → defaults to enabling AI.
    registerCommand('cosmosDB.e2e.setAIFeaturesEnabled', (context: IActionContext, enabled?: boolean): void => {
        context.telemetry.properties.isE2eTest = 'true';
        const isEnabled = enabled ?? true;
        ext.isAIFeaturesEnabled = isEnabled;
        context.telemetry.properties.aiFeaturesEnabled = String(isEnabled);
        QueryEditorTab.notifyAIFeaturesChanged(isEnabled);
    });

    // Installs a fixed pair of fake Copilot models so the Generate Query input's
    // model switcher renders and behaves without a real Copilot install. The
    // override bypasses `vscode.lm.selectChatModels` inside `aiUtils`. Invoked
    // from the palette with no args (palette can't pass arguments), so the
    // fixtures are baked into the command. Pass `false` to clear the override.
    registerCommand('cosmosDB.e2e.setMockLanguageModels', (context: IActionContext, enabled?: boolean): void => {
        context.telemetry.properties.isE2eTest = 'true';
        const shouldMock = enabled ?? true;
        setE2eModelOverride(shouldMock ? E2E_MOCK_MODELS : undefined);
        context.telemetry.measurements.modelCount = shouldMock ? E2E_MOCK_MODELS.length : 0;
    });

    // Clears the fake-model override so it can't leak into other specs that
    // share the worker's VS Code instance. Palette can't pass args, so this is
    // a dedicated no-arg counterpart to `setMockLanguageModels`.
    registerCommand('cosmosDB.e2e.clearMockLanguageModels', (context: IActionContext): void => {
        context.telemetry.properties.isE2eTest = 'true';
        setE2eModelOverride(undefined);
    });

    // Forces the survey-candidate flag so the thumbs up/down feedback buttons
    // in the Generate Query input render regardless of the test VS Code's
    // `telemetry.feedback.enabled` setting. Invoked with no arg → defaults on.
    registerCommand('cosmosDB.e2e.setSurveyCandidate', (context: IActionContext, isCandidate?: boolean): void => {
        context.telemetry.properties.isE2eTest = 'true';
        const value = isCandidate ?? true;
        context.telemetry.properties.surveyCandidate = String(value);
        QueryEditorTab.notifySurveyCandidate(value);
    });

    // ─── Generate Query mock commands ───────────────────────────────────
    // Every path runs through the *real* `generateQueryWithLLM` service, driven
    // by a route-aware mock language model (see `setE2eGenerateQueryRoute` in
    // `generateQueryMockModel`). Each command selects the route the mock follows
    // on its next request:
    //   - success       → streams a query
    //   - error         → streams an `ERROR:` refusal
    //   - schemaConfirm → streams a schema-sampling tool call, driving the real
    //                     agentic loop → Allow/Not now dialog, then a query
    //   - latency       → stalls until cancelled, to exercise Cancel
    // Palette can't pass args, so each route gets its own command.

    registerCommand('cosmosDB.e2e.setMockGenerateQuerySuccess', (context: IActionContext): void => {
        context.telemetry.properties.isE2eTest = 'true';
        setE2eGenerateQueryRoute('success');
    });

    registerCommand('cosmosDB.e2e.setMockGenerateQueryError', (context: IActionContext): void => {
        context.telemetry.properties.isE2eTest = 'true';
        setE2eGenerateQueryRoute('error');
    });

    registerCommand('cosmosDB.e2e.setMockGenerateQuerySchemaConfirm', (context: IActionContext): void => {
        context.telemetry.properties.isE2eTest = 'true';
        setE2eGenerateQueryRoute('schemaConfirm');
    });

    registerCommand('cosmosDB.e2e.setMockGenerateQueryLatency', (context: IActionContext): void => {
        context.telemetry.properties.isE2eTest = 'true';
        setE2eGenerateQueryRoute('latency');
    });

    // Clears the generate-query mock route so it can't leak into other specs.
    registerCommand('cosmosDB.e2e.clearMockGenerateQueryResult', (context: IActionContext): void => {
        context.telemetry.properties.isE2eTest = 'true';
        setE2eGenerateQueryRoute(undefined);
    });
}
