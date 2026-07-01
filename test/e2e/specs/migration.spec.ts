/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * E2E coverage for the Migration Assistant webview.
 *
 * Layers:
 *   1. Structural / render — the panel mounts and all four phase sections and
 *      the model dropdown render.
 *   2. Non-AI interactions — toggling consent and the initial disabled-control
 *      state on a fresh project (no AI involved).
 *   3. Loaded-project state — a deterministic pre-seeded project hydrates with
 *      consent granted, the model populated, and Discovery enabled.
 *   4. Full AI phase flows — Discovery → Assessment → Conversion driven to
 *      completion against the offline migration AI mock
 *      (`src/panels/migration/helpers/e2eMigrationAiMock.ts`).
 *
 * The seeded/AI flows rely on the `cosmosDB.e2e.openMigration*` test-only
 * commands and the `COSMOSDB_E2E_MIGRATION_AI_MOCK` env flag, both wired up by
 * the Playwright fixture in `test/e2e/fixtures/vscode.ts`.
 */

import {
    clearMockControl,
    gitDirExists,
    MigrationPage,
    PHASE_HEADERS,
    provisioningArtifactExists,
    readCapturedPrompts,
    readEmulatorItems,
    readGitignore,
    readMigrationArtifact,
    readMigrationJson,
    readSampleData,
    setMockControl,
    writeCodeMigrationPlan,
} from '../fixtures/migration';
import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs } from '../fixtures/webviewHelpers';
import { openMigrationFresh, openMigrationSeeded } from '../fixtures/webviews';

test.describe('Migration Assistant', () => {
    // Worker-scoped VS Code is reused across tests; reset editor state so panels
    // from one test don't leak into the next. The e2e open commands also reset
    // the on-disk `.cosmosdb-migration` folder, keeping each test hermetic.
    test.afterEach(async ({ vscodeWindow }) => {
        clearMockControl();
        await closeAllEditorTabs(vscodeWindow);
    });

    test('renders all phase sections and the model dropdown', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await expect(migration.root).toBeVisible();
        for (const label of Object.values(PHASE_HEADERS)) {
            await expect(migration.phaseHeader(label)).toBeVisible();
        }
        await expect(migration.modelDropdown).toBeVisible();
    });

    test('exclude-from-VCS checkbox toggles the .gitignore entry', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        // Seeded scenario is git-tracked (`.git` seeded), no warning, exclude renders.
        expect(gitDirExists()).toBe(true);
        await expect(migration.gitInitButton).toHaveCount(0);
        await expect(migration.gitignoreExclude).toBeVisible({ timeout: 15_000 });
        await expect(migration.gitignoreExclude).not.toBeChecked();
        expect(readGitignore()).not.toContain('.cosmosdb-migration');

        // Exclude → entry written; un-exclude → entry removed.
        await migration.gitignoreExclude.click();
        await expect(migration.gitignoreExclude).toBeChecked();
        await expect.poll(() => readGitignore(), { timeout: 10_000 }).toContain('.cosmosdb-migration');
        await migration.gitignoreExclude.click();
        await expect(migration.gitignoreExclude).not.toBeChecked();
        await expect.poll(() => readGitignore(), { timeout: 10_000 }).not.toContain('.cosmosdb-migration');
    });

    test('no version control hides the exclude control and shows the warning', async ({ vscodeWindow }) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const migration = new MigrationPage(frame);

        await expect(migration.gitInitButton).toBeVisible();
        await expect(migration.gitignoreExclude).toHaveCount(0);
    });

    test('fresh project surfaces the Git-init warning', async ({ vscodeWindow }) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const migration = new MigrationPage(frame);
        await expect(migration.gitInitButton).toBeVisible();
    });

    test('seeded project hydrates with consent and Discovery enabled', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await expect(migration.consentCheckbox).toBeChecked();
        await expect(migration.modelDropdown).toContainText('E2E Mock Model');
        await expect(migration.runDiscoveryButton()).toBeEnabled();
    });

    test('fresh project starts with Discovery disabled and no consent', async ({ vscodeWindow }) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const migration = new MigrationPage(frame);

        await expect(migration.consentCheckbox).not.toBeChecked();
        await expect(migration.runDiscoveryButton()).toBeDisabled();
    });

    test('toggling consent updates the checkbox state', async ({ vscodeWindow }) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const migration = new MigrationPage(frame);

        await expect(migration.consentCheckbox).not.toBeChecked();
        await migration.consentCheckbox.click();
        await expect(migration.consentCheckbox).toBeChecked();
    });

    test('AI-consent checkbox gates Auto-Detect and Discovery', async ({ vscodeWindow }) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const migration = new MigrationPage(frame);

        // Without consent both AI entry points are locked.
        await expect(migration.consentCheckbox).not.toBeChecked();
        await expect(migration.autoDetectButton).toBeDisabled();
        await expect(migration.runDiscoveryButton()).toBeDisabled();

        // Consent unlocks Auto-Detect; re-uncheck re-locks it.
        await migration.consentCheckbox.click();
        await expect(migration.autoDetectButton).toBeEnabled();
        await migration.consentCheckbox.click();
        await expect(migration.autoDetectButton).toBeDisabled();
    });

    test('Auto-Detect populates application details (AI mocked)', async ({ vscodeWindow }) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const migration = new MigrationPage(frame);

        await migration.consentCheckbox.click();
        await migration.autoDetectButton.click();
        // Mock returns the canned ApplicationDetails — assert every field is filled.
        await expect(migration.analysisField('project-name')).toHaveValue('Contoso Sales', { timeout: 30_000 });
        await expect(migration.analysisField('project-type')).toHaveValue('Web API');
        await expect(migration.analysisField('language')).toHaveValue('C#');
        await expect(migration.analysisField('frameworks')).toHaveValue('ASP.NET Core, Entity Framework');
        await expect(migration.analysisField('database')).toHaveValue('SQL Server');
        await expect(migration.analysisField('access')).toHaveValue('Entity Framework');
    });

    test('phase instructions reach the AI prompt', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        const marker = `e2e-marker-${Date.now()}`;
        await migration.instructions('discovery').fill(`Focus on the ${marker} domain.`);
        await migration.runDiscovery();

        // The mock captures every prompt; the typed instruction must appear.
        await expect
            .poll(() => readCapturedPrompts().some((p) => p.promptText.includes(marker)), { timeout: 15_000 })
            .toBe(true);
    });

    test('Discovery shows progress + cancel, then completes', async ({ vscodeWindow }) => {
        setMockControl({ delayMs: 3000 });
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await migration.runDiscoveryButton().click();
        await expect(migration.progressBar).toBeVisible();
        await expect(migration.cancelButton).toBeVisible();
        await expect(migration.phaseCompleteBadge('phase1')).toBeVisible({ timeout: 30_000 });
    });

    test('Cancel aborts Discovery without completing', async ({ vscodeWindow }) => {
        setMockControl({ delayMs: 20_000 });
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await migration.runDiscoveryButton().click();
        await expect(migration.cancelButton).toBeVisible();
        await migration.cancelButton.click();
        await expect(migration.cancelButton).toHaveCount(0);
        await expect(migration.runDiscoveryButton()).toBeEnabled();
    });

    test('Discovery surfaces an error when the model fails', async ({ vscodeWindow }) => {
        setMockControl({ failRoutes: ['step2-discovery'] });
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await migration.runDiscoveryButton().click();
        await expect(migration.errorAlert).toBeVisible({ timeout: 30_000 });
        await expect(migration.phaseCompleteBadge('phase1')).toHaveCount(0);
    });

    test('View Discovery Report opens discovery-report.md', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await migration.runDiscovery();
        await expect(migration.viewDiscoveryButton).toBeVisible();
        await migration.viewDiscoveryButton.click();
        await expect(migration.openedTab(/discovery-report\.md/)).toBeVisible({ timeout: 15_000 });
    });

    test('Phase 2 domain and summary links open their markdown', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await migration.runDiscovery();
        await migration.runAssessment();
        await migration.phase2DomainLinks().first().click();
        await expect(migration.openedTab(/SalesDomain\.md/)).toBeVisible({ timeout: 15_000 });
        await migration.focus();
        await migration.phase2SummaryButton.click();
        await expect(migration.openedTab(/summary\.md/)).toBeVisible({ timeout: 15_000 });
    });

    test('surfaces domain, summary, and schema-model artifacts with links', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        // Phase 2: domains listed in a table, each linking to its summary,
        // plus a link to the full assessment summary.
        await migration.runDiscovery();
        await migration.runAssessment();
        await expect(migration.phase2DomainTable).toBeVisible();
        await expect(migration.phase2DomainLinks()).toHaveCount(1);
        await expect(migration.phase2DomainLinks().first()).toHaveText('SalesDomain');
        await expect(migration.phase2SummaryButton).toBeVisible();

        // Phase 3: converted domains with per-domain summary + JSON model links,
        // plus the merged summary/model artifact buttons.
        await migration.runConversion();
        await expect(migration.phase3DomainTable).toBeVisible();
        await expect(migration.phase3DomainLinks()).toHaveCount(1);
        await expect(migration.phase3DomainLinks().first()).toHaveText('SalesDomain');
        await expect(migration.phase3ModelLinks().first()).toHaveText('JSON');
        await expect(migration.phase3SummaryButton).toBeVisible();
        await expect(migration.phase3ModelButton).toBeVisible();

        // Links must open their exact artifacts: the per-domain JSON link opens
        // that domain's cosmos-model.json, while the merged-model button opens the
        // top-level model.json — distinct files, so the tab names must differ.
        await migration.phase3ModelLinks().first().click();
        await expect(migration.openedTab(/cosmos-model\.json/)).toBeVisible({ timeout: 15_000 });
        await migration.focus();
        await migration.phase3ModelButton.click();
        await expect(migration.openedTab(/^model\.json$/)).toBeVisible({ timeout: 15_000 });
    });

    test('drives Discovery → Assessment → Conversion to completion (AI mocked)', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await migration.runDiscovery();
        await migration.runAssessment();
        await migration.runConversion();

        await expect(migration.phaseCompleteBadge('phase1')).toBeVisible();
        await expect(migration.phaseCompleteBadge('phase2')).toBeVisible();
        await expect(migration.phaseCompleteBadge('phase3')).toBeVisible();

        // Beyond the completion badges, assert the on-disk artifacts each phase
        // produced carry the deterministic content from the mocked AI. This
        // guards against a phase "completing" while writing empty/garbled files.

        // Phase 1 — discovery-report.md (mock markdown, preamble stripped).
        const discoveryReport = readMigrationArtifact('phases/1-discovery/discovery-report.md');
        expect(discoveryReport).toContain('# Discovery Report');
        expect(discoveryReport).toContain('Orders, OrderDetails');
        expect(discoveryReport).toContain('R001-GetOrdersByCustomer');

        // Phase 2 — assessment-summary.md plus the per-domain markdown.
        const assessmentSummary = readMigrationArtifact('phases/2-assessment/assessment-summary.md');
        expect(assessmentSummary).toContain('SalesDomain');
        expect(assessmentSummary).toContain('Orders, OrderDetails');

        const domainMarkdown = readMigrationArtifact('phases/2-assessment/domains/SalesDomain.md');
        expect(domainMarkdown).toContain('# Domain: SalesDomain');
        expect(domainMarkdown).toContain('Aggregate Root: Orders');
        expect(domainMarkdown).toContain('R001-GetOrdersByCustomer');

        // Phase 3 — the merged model.json must describe the single `orders`
        // container partitioned by `/customerId` with the `order` doc type.
        const model = readMigrationJson<{
            containers: { name: string; partitionKeys?: { path: string }[]; entities: { docType: string }[] }[];
        }>('phases/3-schema-conversion/model.json');
        expect(model?.containers).toHaveLength(1);
        expect(model?.containers[0].name).toBe('orders');
        expect(model?.containers[0].partitionKeys?.[0]?.path).toBe('/customerId');
        expect(model?.containers[0].entities[0].docType).toBe('order');

        // Phase 3 — summary.md narrates the same container/partition decision.
        const conversionSummary = readMigrationArtifact('phases/3-schema-conversion/summary.md');
        expect(conversionSummary).toContain('Schema Conversion Summary');
        expect(conversionSummary).toContain('orders');
        expect(conversionSummary).toContain('/customerId');
    });

    test('Phase 4 provisions the emulator with the exact sample data (AI mocked)', async ({ vscodeWindow }) => {
        // Requires a live emulator (8082) — skip on pure-webview runs.
        test.skip(process.env.COSMOSDB_E2E_SKIP_EMULATOR === '1', 'needs the e2e Cosmos DB emulator');

        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        // Phase 4 provisioning consumes model.json, so drive 1→3 first.
        await migration.runDiscovery();
        await migration.runAssessment();
        await migration.runConversion();

        // Target the local emulator, verify the connection.
        await migration.expandPhase(PHASE_HEADERS.phase4);
        await migration.emulatorRadio.click();
        await migration.testConnectionButton.click();
        await expect(migration.connectionVerified).toBeVisible({ timeout: 30_000 });

        // Populate sample data: creates DB + containers and inserts mock items.
        await expect(migration.populateSampleDataButton).toBeEnabled();
        await migration.populateSampleDataButton.click();
        await expect(migration.provisioningSummary).toBeVisible({ timeout: 60_000 });
        await expect(migration.phaseCompleteBadge('phase4')).toBeVisible();

        // Summary reports the database + the single `orders` container.
        await expect(migration.provisioningSummary).toContainText('E2E Migration');
        await expect(migration.provisioningSummary).toContainText('orders');

        // Artifacts written to phases/4-provisioning/.
        await expect.poll(() => provisioningArtifactExists('sample-data.json'), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => provisioningArtifactExists('seed-data.csh'), { timeout: 10_000 }).toBe(true);

        // sample-data.json holds exactly the mocked items.
        const sample = readSampleData();
        expect(sample?.sampleData).toEqual([
            {
                containerName: 'orders',
                items: [
                    { id: 'order-1', customerId: 'c1', total: 100, docType: 'order' },
                    { id: 'order-2', customerId: 'c2', total: 250, docType: 'order' },
                ],
            },
        ]);

        // The emulator was actually provisioned with those exact two documents.
        const items = await readEmulatorItems('E2E Migration', 'orders');
        expect(items).toEqual([
            { id: 'order-1', customerId: 'c1', total: 100, docType: 'order' },
            { id: 'order-2', customerId: 'c2', total: 250, docType: 'order' },
        ]);
    });

    test('Plan Migration is gated on phase completion, then flips to Start once the plan exists', async ({
        vscodeWindow,
    }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        // Phase 4 is not required (IS_PHASE4_REQUIRED === false), so the action
        // gates on Discovery → Assessment → Conversion only. Until those run the
        // primary action stays disabled and reads "Plan Migration".
        await expect(migration.migrationActionButton).toContainText('Plan Migration');
        await expect(migration.migrationActionButton).toBeDisabled();
        await expect(migration.viewPlanLink).toHaveCount(0);

        await migration.runDiscovery();
        // Still gated while Assessment + Conversion remain incomplete.
        await migration.focus();
        await expect(migration.migrationActionButton).toBeDisabled();

        await migration.runAssessment();
        await migration.focus();
        await expect(migration.migrationActionButton).toBeDisabled();

        await migration.runConversion();
        await migration.focus();

        // All required phases complete → the action enables (still "Plan Migration").
        await expect(migration.migrationActionButton).toBeEnabled();
        await expect(migration.migrationActionButton).toContainText('Plan Migration');

        // Click "Plan Migration" (opens Copilot Chat with the generated prompt —
        // a no-op for plan creation in the mocked e2e run), then simulate Chat
        // writing the plan to disk. The file watcher flips hasCodeMigrationPlan.
        await migration.migrationActionButton.click();
        await migration.focus();
        writeCodeMigrationPlan();

        // The plan now exists: "View Plan" appears and the primary action
        // auto-switches from "Plan Migration" to "Start Migration".
        await expect(migration.viewPlanLink).toBeVisible({ timeout: 15_000 });
        await expect(migration.migrationActionButton).toContainText('Start Migration');
        await expect(migration.migrationActionButton).toBeEnabled();
    });
});
