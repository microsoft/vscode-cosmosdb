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
 *   5. Skill-first flow — real WebView dispatch and strict state synchronization,
 *      with authenticated Chat replaced by deterministic fake-agent artifact writes.
 *
 * The seeded/AI flows rely on the `cosmosDB.e2e.openMigration*` test-only
 * commands and the `COSMOSDB_E2E_MIGRATION_AI_MOCK` env flag, both wired up by
 * the Playwright fixture in `test/e2e/fixtures/vscode.ts`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { type ProjectJson } from '../../../src/services/MigrationProjectService';
import {
    addMockRegenerationSentinel,
    checkMockSkillPhaseCompletion,
    clearMockControl,
    gitDirExists,
    MigrationPage,
    PHASE_HEADERS,
    provisioningArtifactExists,
    readApplicationFile,
    readCapturedPrompts,
    readEmulatorItems,
    readGitignore,
    readMigrationArtifact,
    readMigrationJson,
    readSampleData,
    runMockSkillAgent,
    setMigrationSettings,
    setMockControl,
    setMockSkillRunActivity,
    writeCodeMigrationPlan,
    writeCodeMigrationPlanDraft,
} from '../fixtures/migration';
import { expect, test } from '../fixtures/vscode';
import {
    closeAllEditorTabs,
    resetNativeDialogStubs,
    runCommand,
    stubMessageBoxButton,
} from '../fixtures/webviewHelpers';
import { openMigrationAssistant, openMigrationFresh, openMigrationSeeded } from '../fixtures/webviews';

test.describe('Migration Assistant', () => {
    // Worker-scoped VS Code is reused across tests; reset editor state so panels
    // from one test don't leak into the next. The e2e open commands also reset
    // the on-disk `.cosmosdb-migration` folder, keeping each test hermetic.
    test.afterEach(async ({ vscodeWindow, vscodeApp }) => {
        clearMockControl();
        for (const frame of vscodeWindow.frames()) {
            const activity = frame.getByTestId('migration-run-activity');
            if (await activity.count()) {
                const resetStatus = activity.getByRole('button', { name: /Reset Status/ });
                await stubMessageBoxButton(vscodeApp, 'Agent Has Stopped');
                try {
                    await resetStatus.click();
                    await expect(activity).toHaveCount(0);
                } finally {
                    await resetNativeDialogStubs(vscodeApp);
                }
            }
        }
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

    test('file list discloses its expanded state', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const fileListExpander = frame.getByRole('button', { name: /file\(s\) selected/ }).first();

        await expect(fileListExpander).toHaveAttribute('aria-expanded', 'false');
        await fileListExpander.focus();
        const scrollPosition = await frame.locator('html').evaluate((element) => element.scrollTop);
        await fileListExpander.press('Space');
        await expect(fileListExpander).toHaveAttribute('aria-expanded', 'true');
        await expect(frame.locator('html')).toHaveJSProperty('scrollTop', scrollPosition);
        await fileListExpander.press('Enter');
        await expect(fileListExpander).toHaveAttribute('aria-expanded', 'false');
    });

    test('copied and workspace inputs use migration-relative paths without a base path', async ({
        vscodeWindow,
        vscodeApp,
    }) => {
        const externalFolder = mkdtempSync(path.join(tmpdir(), 'migration-input-copy-'));
        const first = path.join(externalFolder, 'first.csv');
        const second = path.join(externalFolder, 'second.csv');
        writeFileSync(first, 'timestamp,duration_ms\n2026-10-03T00:00:00Z,12\n');
        writeFileSync(second, 'timestamp,duration_ms\n2026-10-03T00:00:01Z,20\n');
        const selection = () =>
            readMigrationJson<{
                phases: { discovery: { volumetrics?: { files?: string[]; excludedFiles?: string[] } } };
            }>('project.json')?.phases.discovery.volumetrics;
        try {
            const frame = await openMigrationFresh(vscodeWindow);
            const workspace = process.env.COSMOSDB_E2E_WORKSPACE_DIR!;
            const schema = path.join(workspace, 'selected-schema.sql');
            const workspaceCsv = path.join(workspace, 'workspace-workload.csv');
            writeFileSync(schema, 'CREATE TABLE dbo.Selected (Id int PRIMARY KEY);\n');
            writeFileSync(workspaceCsv, 'duration_ms\n42\n');
            await vscodeApp.evaluate(({ dialog }, filePath) => {
                dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
            }, schema);
            await frame.getByRole('button', { name: 'Select Files…', exact: true }).nth(0).click();
            const schemaSelection = () =>
                readMigrationJson<{
                    phases: { discovery: { schemaInventory?: { files: string[] } } };
                }>('project.json')?.phases.discovery.schemaInventory;
            await expect.poll(schemaSelection).toEqual({ files: ['../selected-schema.sql'] });
            expect(readMigrationArtifact('phases/1-discovery/schema-ddl/selected-schema.sql')).toBeUndefined();

            await stubMessageBoxButton(vscodeApp, 'Copy');
            await vscodeApp.evaluate(({ dialog }, filePath) => {
                dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
            }, first);
            await frame.getByRole('button', { name: 'Select Files…', exact: true }).nth(1).click();
            await expect
                .poll(() => readMigrationArtifact('phases/1-discovery/volumetrics/first.csv'))
                .toContain('duration_ms');
            expect(selection()?.files).toBeUndefined();

            await vscodeApp.evaluate(({ dialog }, folderPath) => {
                dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [folderPath] });
            }, externalFolder);
            await frame.getByRole('button', { name: 'Select Folder…', exact: true }).nth(1).click();
            await expect
                .poll(() => readMigrationArtifact('phases/1-discovery/volumetrics/second.csv'))
                .toContain('duration_ms');
            await expect(frame.getByRole('button', { name: '2 file(s) selected', exact: true })).toBeVisible();
            expect(selection()?.files).toBeUndefined();
            await frame.getByRole('button', { name: '2 file(s) selected', exact: true }).click();
            await frame.getByRole('button', { name: 'Exclude file first.csv', exact: true }).click();
            await expect.poll(selection).toEqual({ excludedFiles: ['phases/1-discovery/volumetrics/first.csv'] });
            await vscodeApp.evaluate(({ dialog }, filePath) => {
                dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
            }, first);
            await frame.getByRole('button', { name: 'Select Files…', exact: true }).nth(1).click();
            await expect.poll(selection).toEqual({});
            await expect(frame.getByRole('button', { name: 'Exclude file first.csv', exact: true })).toBeVisible();
            await vscodeApp.evaluate(({ dialog }, filePath) => {
                dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [filePath] });
            }, workspaceCsv);
            await frame.getByRole('button', { name: 'Select Files…', exact: true }).nth(1).click();
            const expected = {
                files: [
                    '../workspace-workload.csv',
                    'phases/1-discovery/volumetrics/first.csv',
                    'phases/1-discovery/volumetrics/second.csv',
                ],
            };
            await expect.poll(selection).toEqual(expected);
            expect(readMigrationArtifact('phases/1-discovery/volumetrics/workspace-workload.csv')).toBeUndefined();
            await closeAllEditorTabs(vscodeWindow);
            const reopened = await openMigrationAssistant(vscodeWindow);
            expect(selection()).toEqual(expected);
            expect(schemaSelection()).toEqual({ files: ['../selected-schema.sql'] });
            await reopened.getByRole('button', { name: '3 file(s) selected', exact: true }).click();
            await reopened.getByRole('button', { name: 'Exclude file workspace-workload.csv', exact: true }).click();
            await expect.poll(selection).toEqual({ ...expected, excludedFiles: ['../workspace-workload.csv'] });
            expect(readApplicationFile('workspace-workload.csv')).toContain('42');
            await reopened.getByRole('button', { name: 'Include file workspace-workload.csv', exact: true }).click();
            await expect.poll(selection).toEqual(expected);
            await resetNativeDialogStubs(vscodeApp);
            const excludeCopied = reopened.getByRole('button', { name: 'Exclude file first.csv', exact: true });
            await expect(excludeCopied).toHaveAccessibleDescription('Exclude file');
            await excludeCopied.click();
            await expect
                .poll(selection)
                .toEqual({ ...expected, excludedFiles: ['phases/1-discovery/volumetrics/first.csv'] });
            expect(readMigrationArtifact('phases/1-discovery/volumetrics/first.csv')).toContain('duration_ms');
            await reopened.getByRole('button', { name: 'Include file first.csv', exact: true }).click();
            await expect.poll(selection).toEqual(expected);
            expect(readApplicationFile('workspace-workload.csv')).toContain('42');
        } finally {
            await resetNativeDialogStubs(vscodeApp);
            rmSync(externalFolder, { recursive: true, force: true });
        }
    });

    test('exclusion-only default folders discover new inputs after exclusion and reload', async ({ vscodeWindow }) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const migration = new MigrationPage(frame);
        await migration.consentCheckbox.click();
        await expect.poll(() => readMigrationJson<{ consentGiven?: boolean }>('project.json')?.consentGiven).toBe(true);
        const directory = path.join(
            process.env.COSMOSDB_E2E_WORKSPACE_DIR!,
            '.cosmosdb-migration/phases/1-discovery/volumetrics',
        );
        writeFileSync(path.join(directory, 'ignored.csv'), 'retained source bytes\n');
        writeFileSync(path.join(directory, 'active.csv'), 'active source bytes\n');
        const selection = () =>
            readMigrationJson<{
                phases: { discovery: { volumetrics?: { files?: string[]; excludedFiles?: string[] } } };
            }>('project.json')?.phases.discovery.volumetrics;

        await frame.getByRole('button', { name: '2 file(s) selected', exact: true }).click();
        await frame.getByRole('button', { name: 'Exclude file ignored.csv', exact: true }).click();
        const excluded = { excludedFiles: ['phases/1-discovery/volumetrics/ignored.csv'] };
        await expect.poll(selection).toEqual(excluded);
        await expect(frame.getByRole('button', { name: '1 file(s) selected', exact: true })).toBeVisible();
        writeFileSync(path.join(directory, 'added.csv'), 'added after exclusion\n');
        await expect(frame.getByRole('button', { name: 'Exclude file added.csv', exact: true })).toBeVisible();
        expect(selection()).toEqual(excluded);
        expect(readMigrationArtifact('phases/1-discovery/volumetrics/ignored.csv')).toBe('retained source bytes\n');

        await closeAllEditorTabs(vscodeWindow);
        const reopened = await openMigrationAssistant(vscodeWindow);
        await reopened.getByRole('button', { name: '2 file(s) selected', exact: true }).click();
        expect(selection()).toEqual(excluded);
        await reopened.getByRole('button', { name: 'Include file ignored.csv', exact: true }).click();
        await expect.poll(selection).toEqual({});
        await expect(reopened.getByRole('button', { name: '3 file(s) selected', exact: true })).toBeVisible();
        expect(readMigrationArtifact('phases/1-discovery/volumetrics/ignored.csv')).toBe('retained source bytes\n');
    });

    test('announces required migration configuration fields', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await expect(frame.getByRole('textbox', { name: /Project Name/ })).toHaveAttribute('required', '');
        await expect(frame.getByTestId('migration-model-dropdown')).toHaveAttribute('aria-required', 'true');

        const analysisFields = [
            ['project-name', 'Project:'],
            ['project-type', 'Type:'],
            ['language', 'Language:'],
            ['database', 'Database:'],
            ['access', 'Access Method:'],
        ] as const;
        for (const [field, name] of analysisFields) {
            await expect(migration.analysisField(field)).toHaveAccessibleName(name);
            await expect(migration.analysisField(field)).toHaveAttribute('required', '');
        }

        await expect(migration.analysisField('frameworks')).toHaveAccessibleName('Frameworks:');
        await expect(migration.analysisField('frameworks')).toHaveJSProperty('required', false);

        const schemaFilesDescription = 'Database Schema Files, required';
        await expect(
            frame.getByRole('button', { name: 'Select Files…', description: schemaFilesDescription }),
        ).toHaveAccessibleDescription(schemaFilesDescription);
        await expect(
            frame.getByRole('button', { name: 'Select Folder…', description: schemaFilesDescription }),
        ).toHaveAccessibleDescription(schemaFilesDescription);
        await expect(
            frame.getByRole('button', { name: 'Generate schema files from workspace code using AI' }),
        ).toHaveAccessibleDescription(schemaFilesDescription);

        await frame.getByRole('button', { name: new RegExp(PHASE_HEADERS.phase4) }).click();
        await expect(frame.getByRole('radiogroup', { name: /Target Environment/ })).toHaveAttribute(
            'aria-required',
            'true',
        );
    });

    test('frameworks are optional and clearing them persists without a placeholder', async ({ vscodeWindow }) => {
        await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Skill Migration Flow');
        try {
            const frame = await openMigrationSeeded(vscodeWindow);
            const migration = new MigrationPage(frame);
            const frameworks = migration.analysisField('frameworks');
            const readFrameworks = () =>
                readMigrationJson<{
                    phases: { discovery: { applicationAnalysis?: { frameworks?: string[] } } };
                }>('project.json')?.phases.discovery.applicationAnalysis?.frameworks;

            await expect(frameworks).toHaveJSProperty('required', false);
            await frameworks.fill('Django, SQLAlchemy');
            await expect.poll(readFrameworks).toEqual(['Django', 'SQLAlchemy']);
            await frameworks.fill('');
            await expect(frameworks).toHaveValue('');
            await expect(frameworks).not.toHaveAttribute('aria-invalid', 'true');
            await expect(migration.runDiscoveryButton()).toBeEnabled();
            await expect.poll(readFrameworks).toEqual([]);

            await closeAllEditorTabs(vscodeWindow);
            const reopened = new MigrationPage(await openMigrationAssistant(vscodeWindow));
            await expect(reopened.analysisField('frameworks')).toHaveValue('');
            await expect(reopened.runDiscoveryButton()).toBeEnabled();
        } finally {
            setMigrationSettings({ useProgrammaticFlow: true });
        }
    });

    test('interactive help links are keyboard accessible', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const helpLinks = [
            ['Database schema files help', 'schema-ddl/'],
            ['Volumetrics help', 'volumetrics/'],
            ['Access patterns help', 'access-patterns/'],
        ] as const;

        for (const [helpLabel, linkLabel] of helpLinks) {
            const trigger = frame.getByRole('button', { name: helpLabel, exact: true });
            await trigger.focus();
            await trigger.press('Enter');

            const link = frame.getByRole('button', { name: linkLabel, exact: true });
            await expect(link).toBeFocused();
            await link.press('Escape');
            await expect(link).toBeHidden();
            await expect(trigger).toBeFocused();
        }
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

    test('AI-consent checkbox gates AI actions', async ({ vscodeWindow }) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const migration = new MigrationPage(frame);

        await expect(migration.consentCheckbox).not.toBeChecked();
        await expect(migration.autoDetectButton).toBeDisabled();
        await expect(migration.generateSchemaButton).toBeDisabled();
        await expect(migration.updateVolumetricsButton).toBeDisabled();
        await expect(migration.updateAccessPatternsButton).toBeDisabled();
        await expect(migration.runDiscoveryButton()).toBeDisabled();

        const consentDescription = 'AI consent is required to use this action.';
        await expect(migration.generateSchemaButton).toHaveAccessibleDescription(new RegExp(consentDescription));
        await expect(migration.updateVolumetricsButton).toHaveAccessibleDescription(consentDescription);
        await expect(migration.updateAccessPatternsButton).toHaveAccessibleDescription(consentDescription);

        for (const button of [
            migration.generateSchemaButton,
            migration.updateVolumetricsButton,
            migration.updateAccessPatternsButton,
        ]) {
            await button.hover();
            await expect(frame.getByRole('tooltip')).toHaveText(consentDescription);
        }

        await migration.consentCheckbox.click();
        await expect(migration.autoDetectButton).toBeEnabled();
        await expect(migration.generateSchemaButton).toBeEnabled();
        await expect(migration.updateVolumetricsButton).toBeEnabled();
        await expect(migration.updateAccessPatternsButton).toBeEnabled();

        await migration.consentCheckbox.click();
        await expect(migration.autoDetectButton).toBeDisabled();
        await expect(migration.generateSchemaButton).toBeDisabled();
        await expect(migration.updateVolumetricsButton).toBeDisabled();
        await expect(migration.updateAccessPatternsButton).toBeDisabled();
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

        const moreButton = frame.getByRole('button', { name: 'More…', exact: true });
        await expect(moreButton).toHaveText('More…');
        await expect(moreButton).toHaveAccessibleName('More…');
        await expect(moreButton).toHaveAccessibleDescription('Show full migration assistant description');
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

    test('View Discovery Report opens summary.md', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await migration.runDiscovery();
        await expect(migration.viewDiscoveryButton).toBeVisible();
        await migration.viewDiscoveryButton.click();
        await expect(migration.openedTab(/summary\.md/)).toBeVisible({ timeout: 15_000 });
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

    test('Phase 2 announces whether a domain is referenced in code', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        await migration.runDiscovery();
        await migration.runAssessment();

        const salesDomainRow = migration.phase2DomainTable.getByRole('row').filter({ hasText: 'SalesDomain' });
        const referencedCell = salesDomainRow.getByRole('cell', { name: 'Yes', exact: true });
        await expect(referencedCell).toBeVisible();
        await expect(referencedCell.getByRole('img', { name: 'Yes', exact: true })).toBeVisible();
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

        // Phase 1 discovery summary (mock markdown, preamble stripped).
        const discoveryReport = readMigrationArtifact('phases/1-discovery/discovery-report.md');
        expect(discoveryReport).toContain('# Discovery Report');
        expect(discoveryReport).toContain('Orders, OrderDetails');
        expect(discoveryReport).toContain('R001-GetOrdersByCustomer');

        // Phase 2 assessment summary plus the per-domain markdown.
        const assessmentSummary = readMigrationArtifact('phases/2-assessment/assessment-summary.md');
        expect(assessmentSummary).toContain('SalesDomain');
        expect(assessmentSummary).toContain('Orders, OrderDetails');

        const domainMarkdown = readMigrationArtifact('phases/2-assessment/domains/SalesDomain/summary.md');
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

    test('starts Skill Discovery from launch preconditions without completed preflight', async ({ vscodeWindow }) => {
        await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Skill Migration Flow');
        try {
            const frame = await openMigrationFresh(vscodeWindow);
            const migration = new MigrationPage(frame);
            const projectName = frame.getByRole('textbox', { name: /Project Name/ });
            const discovery = migration.runDiscoveryButton();

            await expect(migration.modelDropdown).toContainText('E2E Mock Model');
            await expect(discovery).toBeDisabled();
            await migration.consentCheckbox.click();
            await expect(discovery).toBeEnabled();

            await projectName.fill('   ');
            await expect(discovery).toBeDisabled();
            await projectName.fill('Discovery launch test');
            await expect(discovery).toBeEnabled();
            await expect(discovery).toHaveText('Generate Discovery Report');
            await expect(discovery).toHaveAccessibleName('Generate Discovery Report');

            expect(checkMockSkillPhaseCompletion('preflight').complete).toBe(false);
            await discovery.click();
            await expect
                .poll(() => readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-discovery')?.promptText)
                .toContain('Run the discovery phase');
            await expect(discovery).toHaveText(/Running/);
            await expect(discovery).toHaveAccessibleName(/Running.*Reset Status/);
            expect(readMigrationJson<{ execution?: unknown }>('project.json')?.execution).toBeUndefined();
            expect(checkMockSkillPhaseCompletion('preflight').complete).toBe(false);
            expect(checkMockSkillPhaseCompletion('discovery').complete).toBe(false);
            setMockSkillRunActivity(readCapturedPrompts().at(-1)?.promptText ?? '', 'cancelled');
            await expect(discovery).toBeEnabled();
        } finally {
            setMigrationSettings({ useProgrammaticFlow: true });
        }
    });

    for (const [subfolder, label, heading] of [
        ['volumetrics', 'Open Volumetrics Template', 'Volumetrics'],
        ['access-patterns', 'Open Access-Patterns Template', 'Access Patterns'],
    ] as const) {
        for (const existing of [true, false]) {
            test(`opens ${existing ? 'existing' : 'missing'} ${subfolder} template during an active phase`, async ({
                vscodeWindow,
            }) => {
                await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Skill Migration Flow');
                let prompt = '';
                try {
                    const frame = await openMigrationSeeded(vscodeWindow);
                    const migration = new MigrationPage(frame);
                    const relativePath = `phases/1-discovery/${subfolder}/${subfolder}.md`;
                    const templatePath = path.join(
                        process.env.COSMOSDB_E2E_WORKSPACE_DIR!,
                        '.cosmosdb-migration',
                        relativePath,
                    );
                    const content = `# ${heading}\n\nCustom template contents.\n`;
                    if (existing) {
                        mkdirSync(path.dirname(templatePath), { recursive: true });
                        writeFileSync(templatePath, content);
                    } else {
                        rmSync(templatePath, { force: true });
                    }
                    await migration.generateSchemaButton.click();
                    const activity = frame.getByTestId('migration-run-activity');
                    await expect(activity).toHaveAttribute('data-activity', 'running');
                    prompt = readCapturedPrompts().at(-1)?.promptText ?? '';
                    const promptCount = readCapturedPrompts().length;
                    const checkpoint = readMigrationArtifact('project.json');
                    const templateButton = frame.getByRole('button', { name: label, exact: true });
                    await expect(templateButton).toBeEnabled();
                    await expect(templateButton).toHaveAccessibleName(label);
                    await templateButton.click();
                    await expect(migration.openedTab(`${subfolder}.md`)).toHaveAttribute('aria-selected', 'true');
                    await expect(vscodeWindow.locator('.monaco-editor:visible .view-lines').first()).toContainText(
                        existing ? 'Custom template contents.' : /Fill\s+in\s+the\s+table/,
                    );
                    await migration.focus();
                    await expect(activity).toHaveAttribute('data-activity', 'running');
                    expect(readMigrationArtifact('project.json')).toBe(checkpoint);
                    const templateContent = readMigrationArtifact(relativePath);
                    if (existing) {
                        expect(templateContent).toBe(content);
                    } else {
                        expect(templateContent).toContain(`# ${heading}`);
                        expect(templateContent).toContain('Fill in the table');
                    }
                    expect(readCapturedPrompts()).toHaveLength(promptCount);
                } finally {
                    if (prompt) setMockSkillRunActivity(prompt, 'cancelled');
                    setMigrationSettings({ useProgrammaticFlow: true });
                }
            });
        }
    }

    test('resets active Skill status from its launch button without changing checkpoints', async ({
        vscodeWindow,
        vscodeApp,
    }) => {
        await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Skill Migration Flow');
        try {
            let frame = await openMigrationSeeded(vscodeWindow);
            let migration = new MigrationPage(frame);
            await migration.generateSchemaButton.click();
            const activity = frame.getByTestId('migration-run-activity');
            await expect(activity).toHaveAttribute('data-activity', 'running');
            const prompt = readCapturedPrompts().at(-1)?.promptText ?? '';
            const promptCount = readCapturedPrompts().length;
            const checkpoint = readMigrationArtifact('project.json');
            const resetButton = activity.getByRole('button');
            await expect(resetButton).toHaveAccessibleName(/Reset Status.*Generate schema/);
            await expect(resetButton).toHaveAccessibleDescription(/does not stop the agent in Chat/);
            await stubMessageBoxButton(vscodeApp, 'Agent Has Stopped');
            await resetButton.click();
            await expect(activity).toHaveCount(0);
            await expect(migration.generateSchemaButton).toBeEnabled();
            expect(readCapturedPrompts()).toHaveLength(promptCount);
            expect(readMigrationArtifact('project.json')).toBe(checkpoint);

            setMockSkillRunActivity(prompt, 'running');
            await closeAllEditorTabs(vscodeWindow);
            frame = await openMigrationAssistant(vscodeWindow);
            migration = new MigrationPage(frame);
            await expect(migration.generateSchemaButton).toBeEnabled();
            await expect(frame.getByTestId('migration-run-activity')).toHaveCount(0);
            await migration.generateSchemaButton.click();
            await expect.poll(() => readCapturedPrompts().length).toBe(promptCount + 1);
        } finally {
            await resetNativeDialogStubs(vscodeApp);
            setMigrationSettings({ useProgrammaticFlow: true });
        }
    });

    test('tracks Skill activity and reopens read-only without relaunching Chat', async ({
        vscodeWindow,
        vscodeApp,
    }, testInfo) => {
        await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Skill Migration Flow');
        let prompt = '';
        try {
            let frame = await openMigrationSeeded(vscodeWindow);
            let migration = new MigrationPage(frame);
            const originalBounds = await migration.generateSchemaButton.boundingBox();
            await migration.generateSchemaButton.click();
            await expect(frame.getByTestId('migration-run-activity')).toHaveAttribute('data-activity', 'running');
            await expect(frame.getByTestId('migration-run-activity')).toHaveCount(1);
            await expect(
                frame.getByTestId('migration-step-schema-acquisition').getByTestId('migration-run-activity'),
            ).toHaveCount(0);
            prompt = readCapturedPrompts().at(-1)?.promptText ?? '';
            expect(prompt).toMatch(/^Run ID: /mu);
            const count = readCapturedPrompts().length;
            await expect(migration.autoDetectButton).toBeDisabled();
            await expect(migration.modelDropdown).toBeDisabled();
            const resetStatus = frame.getByTestId('migration-run-activity').getByRole('button');
            await expect(resetStatus).toHaveText('');
            await expect(resetStatus).toHaveAccessibleName(/Reset Status.*Generate schema/);
            await expect(resetStatus).toHaveAccessibleDescription(/Running/);
            const activeBounds = await resetStatus.boundingBox();
            expect(activeBounds?.width).toBe(originalBounds?.width);
            expect(activeBounds?.height).toBe(originalBounds?.height);
            await expect(frame.getByRole('button', { name: /Confirm Stopped|Refresh Status|Cancel/ })).toHaveCount(0);
            await resetStatus.press('Shift+F10');
            await frame.getByRole('menuitem', { name: 'Open Chat', exact: true }).click();
            expect(readCapturedPrompts()).toHaveLength(count);

            setMockSkillRunActivity(prompt, 'running');
            await expect(frame.getByTestId('migration-run-activity')).toHaveAttribute('data-activity', 'running');
            setMockSkillRunActivity(prompt, 'waiting-for-decision', 'Choose the source parser in Chat.');
            await expect(resetStatus).toHaveAccessibleDescription(/Needs input.*Choose the source parser/);
            await frame
                .getByTestId('migration-run-activity')
                .screenshot({ path: testInfo.outputPath('run-activity-desktop.png') });
            const viewport =
                vscodeWindow.viewportSize() ??
                (await vscodeWindow.evaluate(() => ({
                    width: window.innerWidth,
                    height: window.innerHeight,
                })));
            await vscodeWindow.setViewportSize({ width: 720, height: 900 });
            await expect(resetStatus).toBeVisible();
            await resetStatus.hover();
            await frame
                .getByTestId('migration-run-activity')
                .evaluate((element) => element.scrollIntoView({ block: 'center' }));
            await frame
                .getByTestId('migration-run-activity')
                .screenshot({ path: testInfo.outputPath('run-activity-narrow.png') });
            await vscodeWindow.setViewportSize(viewport);
            const beforeReopen = readMigrationArtifact('project.json');
            await closeAllEditorTabs(vscodeWindow);
            frame = await openMigrationAssistant(vscodeWindow);
            migration = new MigrationPage(frame);
            await expect(frame.getByTestId('migration-run-activity')).toHaveAttribute(
                'data-activity',
                'waiting-for-decision',
            );
            expect(readMigrationArtifact('project.json')).toBe(beforeReopen);
            expect(readCapturedPrompts()).toHaveLength(count);
            const reopenedButton = frame.getByTestId('migration-run-activity').getByRole('button');
            await reopenedButton.press('Shift+F10');
            const refresh = frame.getByRole('menuitem', { name: 'Refresh Status', exact: true });
            await refresh.click();
            await expect(reopenedButton).toBeFocused();
            await expect(migration.autoDetectButton).toBeDisabled();

            setMockSkillRunActivity(prompt, 'blocked', 'Source schema needs review.');
            await expect(frame.getByTestId('migration-run-activity')).toHaveCount(0);
            await expect(migration.autoDetectButton).toBeEnabled();
            runMockSkillAgent(prompt);
            await expect(frame.getByTestId('migration-run-activity')).toHaveCount(0);
            await expect(migration.generateSchemaButton).toBeVisible();
            await expect(migration.modelDropdown).toBeEnabled();

            const locations = [
                ['preflight', null, 'Auto-Detect'],
                ['preflight', 'application-details', 'Auto-Detect'],
                ['preflight', 'volumetrics', 'Update volumetrics'],
                ['preflight', 'access-patterns', 'Update access-patterns'],
                ['discovery', null, 'Generate Discovery Report'],
                ['assessment', null, 'Run Assessment'],
                ['schema-conversion', null, 'Run Schema Conversion'],
                ['provisioning', 'target-account', 'Provision New Account'],
                ['provisioning', 'resources-and-data', 'Populate Sample Data'],
                ['code-migration', null, 'Plan Migration'],
            ] as const;
            for (const [phase, step, label] of locations) {
                const discoveryBounds =
                    phase === 'discovery' ? await migration.runDiscoveryButton().boundingBox() : undefined;
                prompt = [
                    `Run the ${phase.replaceAll('-', ' ')} phase of a relational database migration to Azure Cosmos DB.`,
                    'Use the cosmosdb-relational-migration skill.',
                    ...(step ? [`Run only the ${step} ${phase} step.`] : []),
                    `Run ID: inline-${phase}-${step ?? 'phase'}`,
                ].join('\n');
                setMockSkillRunActivity(prompt, 'running');
                const activity = frame.getByTestId('migration-run-activity');
                const statusButton = activity.getByRole('button', { name: new RegExp(`Reset Status.*${label}`) });
                await expect(statusButton).toBeVisible();
                await expect(activity).toHaveCount(1);
                if (phase === 'preflight') {
                    await expect(activity.getByRole('button')).toHaveCount(1);
                } else {
                    await expect(activity.getByRole('button', { name: 'Refresh Status', exact: true })).toBeVisible();
                    await expect(activity.getByRole('button', { name: 'Confirm Stopped', exact: true })).toBeVisible();
                    await expect(statusButton).toHaveText(/Running/);
                    if (discoveryBounds) {
                        const runningBounds = await statusButton.boundingBox();
                        expect(runningBounds?.width).toBe(discoveryBounds.width);
                        expect(runningBounds?.height).toBe(discoveryBounds.height);
                    }
                }
                if (phase === 'assessment') {
                    await activity.screenshot({ path: testInfo.outputPath('run-activity-assessment-button.png') });
                }
                const checkpoint = readMigrationArtifact('project.json');
                await stubMessageBoxButton(vscodeApp, 'Agent Has Stopped');
                await statusButton.click();
                await expect(activity).toHaveCount(0);
                expect(readMigrationArtifact('project.json')).toBe(checkpoint);
                expect(readCapturedPrompts()).toHaveLength(count);
            }
        } finally {
            await resetNativeDialogStubs(vscodeApp);
            if (prompt) setMockSkillRunActivity(prompt, 'cancelled');
            setMigrationSettings({ useProgrammaticFlow: true });
        }
    });

    test('preserves Auto across UX sessions and uses the legacy model fallback', async ({ vscodeWindow }) => {
        await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Skill Migration Flow');
        setMigrationSettings({ showTokenEstimate: true });
        try {
            let frame = await openMigrationSeeded(vscodeWindow);
            let migration = new MigrationPage(frame);
            await expect(migration.modelDropdown).toContainText('E2E Mock Model');
            await expect(frame.getByText(/Estimating tokens|Token estimate unavailable|^~.+ tokens$/)).toHaveCount(0);
            await migration.modelDropdown.click();
            const autoOption = frame.getByRole('option', { name: 'Auto', exact: true });
            await expect(autoOption).toHaveText('Auto');
            await expect(autoOption).toHaveAccessibleName('Auto');
            await autoOption.click();
            const firstCount = readCapturedPrompts().length;
            await migration.generateSchemaButton.click();
            await expect.poll(() => readCapturedPrompts().length).toBeGreaterThan(firstCount);
            await expect
                .poll(() => readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-preflight')?.chat)
                .toEqual({ newSession: true, modelSelector: { vendor: 'copilot', id: 'auto' } });
            await expect(frame.getByText(/Estimating tokens|Token estimate unavailable|^~.+ tokens$/)).toHaveCount(0);
            await expect(frame.getByRole('progressbar')).toHaveCount(0);
            setMockSkillRunActivity(readCapturedPrompts().at(-1)?.promptText ?? '', 'complete');
            await expect(frame.getByTestId('migration-run-activity')).toHaveCount(0);

            await openMigrationAssistant(vscodeWindow);
            const count = readCapturedPrompts().length;
            await migration.autoDetectButton.click();
            await expect.poll(() => readCapturedPrompts().length).toBeGreaterThan(count);
            expect(readCapturedPrompts().at(-1)?.chat).toEqual({
                newSession: false,
                modelSelector: { vendor: 'copilot', id: 'auto' },
            });
            setMockSkillRunActivity(readCapturedPrompts().at(-1)?.promptText ?? '', 'complete');
            await expect(frame.getByTestId('migration-run-activity')).toHaveCount(0);

            await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Programmatic Migration Flow');
            await expect(migration.modelDropdown).toContainText('E2E Mock Model');
            await migration.modelDropdown.click();
            await expect(frame.getByRole('option', { name: 'Auto', exact: true })).toHaveCount(0);
            await migration.modelDropdown.press('Escape');
            await expect(frame.getByText('Token estimate unavailable for Auto.', { exact: true })).toHaveCount(0);
            await expect(frame.getByText(/^~.+ tokens$/)).toBeVisible();
            await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Skill Migration Flow');
            await expect(migration.modelDropdown).toContainText('Auto');
            await expect(frame.getByText(/Estimating tokens|Token estimate unavailable|^~.+ tokens$/)).toHaveCount(0);

            await closeAllEditorTabs(vscodeWindow);
            frame = await openMigrationSeeded(vscodeWindow);
            migration = new MigrationPage(frame);
            await expect(migration.modelDropdown).toContainText('Auto');
            const reopenedCount = readCapturedPrompts().length;
            await migration.generateSchemaButton.click();
            await expect.poll(() => readCapturedPrompts().length).toBeGreaterThan(reopenedCount);
            await expect
                .poll(() => readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-preflight')?.chat)
                .toEqual({ newSession: true, modelSelector: { vendor: 'copilot', id: 'auto' } });

            setMockSkillRunActivity(readCapturedPrompts().at(-1)?.promptText ?? '', 'complete');
            await expect(frame.getByTestId('migration-run-activity')).toHaveCount(0);
            await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Programmatic Migration Flow');
            await expect(migration.modelDropdown).toContainText('E2E Mock Model');
            await migration.modelDropdown.click();
            await frame.getByRole('option', { name: /E2E Mock Model/ }).click();
            await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Skill Migration Flow');
            await expect(migration.modelDropdown).toContainText('E2E Mock Model');
            await expect(frame.getByText(/Estimating tokens|Token estimate unavailable|^~.+ tokens$/)).toHaveCount(0);
            const concreteCount = readCapturedPrompts().length;
            await migration.generateSchemaButton.click();
            await expect.poll(() => readCapturedPrompts().length).toBeGreaterThan(concreteCount);
            await expect
                .poll(() => readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-preflight')?.chat)
                .toEqual({ newSession: false, modelSelector: { vendor: 'copilot', id: 'e2e-mock-migration-model' } });
            setMockSkillRunActivity(readCapturedPrompts().at(-1)?.promptText ?? '', 'complete');
            await expect(frame.getByTestId('migration-run-activity')).toHaveCount(0);
        } finally {
            setMigrationSettings({ showTokenEstimate: false, useProgrammaticFlow: true });
        }
    });

    test('drives Skill-first preflight through code migration with a mocked agent', async ({ vscodeWindow }) => {
        await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Skill Migration Flow');
        try {
            const frame = await openMigrationSeeded(vscodeWindow);
            const migration = new MigrationPage(frame);
            const suppliedDdl = readMigrationArtifact('phases/1-discovery/schema-ddl/schema.sql');

            await expect(
                migration.generateSchemaButton,
                (await frame.getByTestId('migration-run-activity').allTextContents()).join('\n'),
            ).toBeEnabled();
            await migration.generateSchemaButton.click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast(
                            (prompt) =>
                                prompt.route === 'skill-preflight' &&
                                prompt.promptText.includes('Run only the schema-acquisition preflight step.'),
                        )?.promptText ?? '',
                    { timeout: 15_000 },
                )
                .toContain('Run only the schema-acquisition preflight step.');
            runMockSkillAgent(
                readCapturedPrompts().findLast(
                    (prompt) =>
                        prompt.route === 'skill-preflight' &&
                        prompt.promptText.includes('Run only the schema-acquisition preflight step.'),
                )?.promptText ?? '',
            );
            expect(readMigrationArtifact('phases/1-discovery/schema-ddl/schema.sql')).toBe(suppliedDdl);

            await migration.autoDetectButton.click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast(
                            (prompt) =>
                                prompt.route === 'skill-preflight' &&
                                prompt.promptText.includes('Run only the application-details preflight step.'),
                        )?.promptText ?? '',
                    { timeout: 15_000 },
                )
                .toContain('Run only the application-details preflight step.');
            runMockSkillAgent(
                readCapturedPrompts().findLast(
                    (prompt) =>
                        prompt.route === 'skill-preflight' &&
                        prompt.promptText.includes('Run only the application-details preflight step.'),
                )?.promptText ?? '',
            );

            await migration.updateVolumetricsButton.click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast(
                            (prompt) =>
                                prompt.route === 'skill-preflight' &&
                                prompt.promptText.includes('Run only the volumetrics preflight step.'),
                        )?.promptText ?? '',
                    { timeout: 15_000 },
                )
                .toContain('Run only the volumetrics preflight step.');
            runMockSkillAgent(
                readCapturedPrompts().findLast(
                    (prompt) =>
                        prompt.route === 'skill-preflight' &&
                        prompt.promptText.includes('Run only the volumetrics preflight step.'),
                )?.promptText ?? '',
            );

            await migration.updateAccessPatternsButton.click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast(
                            (prompt) =>
                                prompt.route === 'skill-preflight' &&
                                prompt.promptText.includes('Run only the access-patterns preflight step.'),
                        )?.promptText ?? '',
                    { timeout: 15_000 },
                )
                .toContain('Run only the access-patterns preflight step.');
            runMockSkillAgent(
                readCapturedPrompts().findLast(
                    (prompt) =>
                        prompt.route === 'skill-preflight' &&
                        prompt.promptText.includes('Run only the access-patterns preflight step.'),
                )?.promptText ?? '',
            );
            expect(checkMockSkillPhaseCompletion('preflight')).toMatchObject({ complete: true, errors: [] });
            await expect(migration.runDiscoveryButton()).toBeEnabled({ timeout: 15_000 });

            await migration.runDiscoveryButton().click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-discovery')?.promptText ??
                        '',
                    { timeout: 15_000 },
                )
                .toContain('Run the discovery phase');
            const discoveryPrompt = readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-discovery');
            expect(discoveryPrompt?.promptText).toContain('Use the cosmosdb-relational-migration skill.');
            expect(discoveryPrompt?.promptText).not.toContain('This host supports interaction.');
            expect(discoveryPrompt?.promptText).not.toContain('Run in interactive mode.');
            expect(discoveryPrompt?.promptText).toContain('Run the discovery phase');
            expect(discoveryPrompt?.promptText).not.toContain('inspect-migration-state.mjs');
            runMockSkillAgent(discoveryPrompt?.promptText ?? '');
            await expect(migration.phaseCompleteBadge('phase1')).toBeVisible({ timeout: 15_000 });

            addMockRegenerationSentinel('discovery');
            expect(readMigrationArtifact('phases/1-discovery/discovery-report.md')).toContain('REGENERATION-SENTINEL');
            const discoveryPromptCount = readCapturedPrompts().filter(
                (prompt) => prompt.route === 'skill-discovery',
            ).length;
            await migration.runDiscoveryButton().click();
            await expect
                .poll(() => readCapturedPrompts().filter((prompt) => prompt.route === 'skill-discovery').length, {
                    timeout: 15_000,
                })
                .toBeGreaterThan(discoveryPromptCount);
            const regenerationPrompt = readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-discovery');
            expect(regenerationPrompt?.promptText).toContain('Regenerate the discovery results');
            runMockSkillAgent(regenerationPrompt?.promptText ?? '');
            await expect
                .poll(() => readMigrationArtifact('phases/1-discovery/discovery-report.md') ?? '', { timeout: 15_000 })
                .not.toContain('REGENERATION-SENTINEL');

            const crossProducerMarker = `skill-e2e-${Date.now()}`;
            await frame.getByRole('textbox', { name: /Additional Migration Instructions/ }).fill(crossProducerMarker);
            await expect
                .poll(
                    () => readMigrationJson<{ migrationInstructions?: string }>('project.json')?.migrationInstructions,
                    { timeout: 15_000 },
                )
                .toBe(crossProducerMarker);

            await migration.expandPhase(PHASE_HEADERS.phase2);
            await expect(migration.runAssessmentButton()).toBeEnabled();
            await migration.runAssessmentButton().click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-assessment')?.promptText ??
                        '',
                    { timeout: 15_000 },
                )
                .toContain('Run the assessment phase');
            runMockSkillAgent(
                readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-assessment')?.promptText ?? '',
            );
            await expect(migration.phaseCompleteBadge('phase2')).toBeVisible({ timeout: 15_000 });
            await expect(migration.phase2DomainLinks()).toHaveCount(1);
            expect(readMigrationJson<{ migrationInstructions?: string }>('project.json')?.migrationInstructions).toBe(
                crossProducerMarker,
            );

            addMockRegenerationSentinel('assessment');
            const assessmentPromptCount = readCapturedPrompts().filter(
                (prompt) => prompt.route === 'skill-assessment',
            ).length;
            await migration.runAssessmentButton().click();
            await expect
                .poll(() => readCapturedPrompts().filter((prompt) => prompt.route === 'skill-assessment').length, {
                    timeout: 15_000,
                })
                .toBeGreaterThan(assessmentPromptCount);
            const assessmentRegenerationPrompt = readCapturedPrompts().findLast(
                (prompt) => prompt.route === 'skill-assessment',
            );
            runMockSkillAgent(assessmentRegenerationPrompt?.promptText ?? '');
            expect(readMigrationArtifact('phases/2-assessment/assessment-summary.md')).not.toContain(
                'REGENERATION-SENTINEL',
            );
            expect(checkMockSkillPhaseCompletion('assessment')).toMatchObject({ complete: true, errors: [] });

            await migration.expandPhase(PHASE_HEADERS.phase3);
            await expect(migration.runConversionButton()).toBeEnabled();
            await migration.runConversionButton().click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-schema-conversion')
                            ?.promptText ?? '',
                    { timeout: 15_000 },
                )
                .toContain('Run the schema conversion phase');
            const conversionResult = runMockSkillAgent(
                readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-schema-conversion')?.promptText ??
                    '',
            );
            expect(conversionResult.decisions).toContain('partition-key-selection');
            await expect(migration.phaseCompleteBadge('phase3')).toBeVisible({ timeout: 15_000 });
            await expect(migration.phase3DomainLinks()).toHaveCount(1);
            expect(
                readMigrationJson<{ containers: unknown[] }>('phases/3-schema-conversion/model.json')?.containers,
            ).toHaveLength(1);

            addMockRegenerationSentinel('schema-conversion');
            const conversionPromptCount = readCapturedPrompts().filter(
                (prompt) => prompt.route === 'skill-schema-conversion',
            ).length;
            await migration.runConversionButton().click();
            await expect
                .poll(
                    () => readCapturedPrompts().filter((prompt) => prompt.route === 'skill-schema-conversion').length,
                    { timeout: 15_000 },
                )
                .toBeGreaterThan(conversionPromptCount);
            const conversionRegenerationPrompt = readCapturedPrompts().findLast(
                (prompt) => prompt.route === 'skill-schema-conversion',
            );
            runMockSkillAgent(conversionRegenerationPrompt?.promptText ?? '');
            expect(readMigrationArtifact('phases/3-schema-conversion/summary.md')).not.toContain(
                'REGENERATION-SENTINEL',
            );
            expect(checkMockSkillPhaseCompletion('schema-conversion')).toMatchObject({ complete: true, errors: [] });

            runMockSkillAgent(
                [
                    'Run the provisioning phase of a relational database migration to Azure Cosmos DB.',
                    'Run ID: prepare-provisioning',
                ].join('\n'),
            );
            await migration.expandPhase(PHASE_HEADERS.phase4);
            await expect(migration.populateSampleDataButton).toBeEnabled({ timeout: 15_000 });
            await migration.populateSampleDataButton.click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-provisioning')?.promptText ??
                        '',
                    { timeout: 15_000 },
                )
                .toContain('Run only the resources-and-data provisioning step.');
            const provisioningPrompt = readCapturedPrompts().findLast(
                (prompt) => prompt.route === 'skill-provisioning',
            );
            expect(provisioningPrompt?.promptText).toContain('allow-provisioning: true');
            runMockSkillAgent(provisioningPrompt?.promptText ?? '');
            await expect(migration.phaseCompleteBadge('phase4')).toBeVisible({ timeout: 15_000 });
            expect(provisioningArtifactExists('provisioning-verification.json')).toBe(true);

            const firstVerifiedAt = readMigrationJson<{ verifiedAt: string }>(
                'phases/4-provisioning/provisioning-verification.json',
            )?.verifiedAt;
            const provisioningPromptCount = readCapturedPrompts().filter(
                (prompt) => prompt.route === 'skill-provisioning',
            ).length;
            await migration.populateSampleDataButton.click();
            await expect
                .poll(() => readCapturedPrompts().filter((prompt) => prompt.route === 'skill-provisioning').length, {
                    timeout: 15_000,
                })
                .toBeGreaterThan(provisioningPromptCount);
            const provisioningRegenerationPrompt = readCapturedPrompts().findLast(
                (prompt) => prompt.route === 'skill-provisioning',
            );
            runMockSkillAgent(provisioningRegenerationPrompt?.promptText ?? '');
            expect(
                readMigrationJson<{ verifiedAt: string }>('phases/4-provisioning/provisioning-verification.json')
                    ?.verifiedAt,
            ).not.toBe(firstVerifiedAt);
            expect(checkMockSkillPhaseCompletion('provisioning')).toMatchObject({ complete: true, errors: [] });

            await expect(migration.migrationActionButton).toBeEnabled();
            await expect(migration.migrationActionButton).toContainText('Plan Migration');
            await migration.migrationActionButton.click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-code-migration')
                            ?.promptText ?? '',
                    { timeout: 15_000 },
                )
                .toContain('Create the application code migration plan.');
            const planningPrompt = readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-code-migration');
            expect(planningPrompt?.promptText).not.toContain('candidate execution blocker');
            expect(planningPrompt?.promptText).not.toContain('Do not modify application files');
            runMockSkillAgent(planningPrompt?.promptText ?? '');
            await expect(migration.migrationActionButton).toContainText('Migrate Application', { timeout: 15_000 });
            expect(readApplicationFile('src/mockCosmosRepository.js')).toBeUndefined();

            await migration.migrationActionButton.click();
            await expect
                .poll(
                    () =>
                        readCapturedPrompts().findLast(
                            (prompt) =>
                                prompt.route === 'skill-code-migration' &&
                                prompt.promptText.includes(
                                    'Migrate the application code using the validated migration plan.',
                                ),
                        )?.promptText ?? '',
                    { timeout: 15_000 },
                )
                .toContain('Migrate the application code using the validated migration plan.');
            runMockSkillAgent(
                readCapturedPrompts().findLast(
                    (prompt) =>
                        prompt.route === 'skill-code-migration' &&
                        prompt.promptText.includes('Migrate the application code using the validated migration plan.'),
                )?.promptText ?? '',
            );
            const firstMigratedOutput = readApplicationFile('src/mockCosmosRepository.js');
            expect(firstMigratedOutput).toContain('generation 1');
            expect(checkMockSkillPhaseCompletion('code-migration')).toMatchObject({ complete: true, errors: [] });

            const migrationPromptCount = readCapturedPrompts().filter(
                (prompt) => prompt.route === 'skill-code-migration',
            ).length;
            await migration.migrationActionButton.click();
            await expect
                .poll(() => readCapturedPrompts().filter((prompt) => prompt.route === 'skill-code-migration').length, {
                    timeout: 15_000,
                })
                .toBeGreaterThan(migrationPromptCount);
            const migrationRegenerationPrompt = readCapturedPrompts().findLast(
                (prompt) => prompt.route === 'skill-code-migration',
            );
            runMockSkillAgent(migrationRegenerationPrompt?.promptText ?? '');
            expect(readApplicationFile('src/mockCosmosRepository.js')).toContain('generation 2');
            expect(readApplicationFile('src/mockCosmosRepository.js')).not.toBe(firstMigratedOutput);
            expect(checkMockSkillPhaseCompletion('code-migration')).toMatchObject({ complete: true, errors: [] });
            const skillDispatches = readCapturedPrompts().filter((prompt) => prompt.route?.startsWith('skill-'));
            expect(skillDispatches[0]?.chat?.newSession).toBe(true);
            expect(skillDispatches.slice(1).every((prompt) => prompt.chat?.newSession === false)).toBe(true);
            expect(
                skillDispatches.every((prompt) => prompt.chat?.modelSelector.id === 'e2e-mock-migration-model'),
            ).toBe(true);
        } finally {
            await runCommand(vscodeWindow, 'Cosmos DB: [E2E Test] Use Programmatic Migration Flow');
        }
    });

    test('switching from emulator to a new account clears the persisted endpoint', async ({ vscodeWindow }) => {
        await openMigrationSeeded(vscodeWindow);
        await closeAllEditorTabs(vscodeWindow);

        const project = readMigrationJson<ProjectJson>('project.json')!;
        const workspace = process.env.COSMOSDB_E2E_WORKSPACE_DIR!;
        project.phases.discovery.status = 'complete';
        project.phases.discovery.schemaInventory = { files: ['phases/1-discovery/schema-ddl/schema.sql'] };
        project.phases.discovery.volumetrics = { files: [] };
        project.phases.discovery.accessPatterns = { files: [] };
        project.phases.provisioning = {
            status: 'complete',
            databaseName: 'migration-target-db',
            containersCreated: [],
            sampleDataInserted: true,
            completedAt: '2026-10-07T21:27:29.691Z',
        };
        project.phases.targetEnvironment = {
            type: 'emulator',
            endpoint: 'https://localhost:8081/',
            verified: true,
            verifiedAt: '2026-10-07T21:27:29.691Z',
            accountName: 'migration-target-test',
            resourceGroup: 'migration-target-group',
            location: 'eastus',
        };
        writeFileSync(path.join(workspace, '.cosmosdb-migration', 'project.json'), JSON.stringify(project, null, 2));
        const { sourceFixture, discoveryFixture } = createRequire(import.meta.url)(
            path.resolve('skills/cosmosdb-relational-migration/tests/source-evidence-fixtures.mjs'),
        ) as {
            sourceFixture(workspace: string, project: ProjectJson, tables: string[], fileName: string): unknown;
            discoveryFixture(workspace: string, inventory: unknown, project: ProjectJson): void;
        };
        const inventory = sourceFixture(workspace, project, ['dbo.Orders'], 'schema.sql');
        discoveryFixture(workspace, inventory, project);
        expect(checkMockSkillPhaseCompletion('discovery').complete).toBe(true);
        let frame = await openMigrationAssistant(vscodeWindow);
        let migration = new MigrationPage(frame);
        await migration.expandPhase(PHASE_HEADERS.phase4);
        await expect(migration.emulatorRadio).toBeChecked();

        const newAccount = frame.getByRole('radio', { name: 'Provision new Azure Cosmos DB Account', exact: true });
        await expect(newAccount).toHaveAccessibleName('Provision new Azure Cosmos DB Account');
        await newAccount.check();
        const expectedTarget = {
            type: 'provision',
            verified: false,
            accountName: 'migration-target-test',
            resourceGroup: 'migration-target-group',
            location: 'eastus',
        };
        await expect
            .poll(() => readMigrationJson<ProjectJson>('project.json')?.phases.targetEnvironment)
            .toEqual(expectedTarget);
        await expect(frame.getByRole('button', { name: 'Provision New Account', exact: true })).toBeVisible();

        await closeAllEditorTabs(vscodeWindow);
        frame = await openMigrationAssistant(vscodeWindow);
        migration = new MigrationPage(frame);
        await migration.expandPhase(PHASE_HEADERS.phase4);
        await expect(
            frame.getByRole('radio', { name: 'Provision new Azure Cosmos DB Account', exact: true }),
        ).toBeChecked();
        expect(readMigrationJson<ProjectJson>('project.json')?.phases.targetEnvironment).toEqual(expectedTarget);
    });

    test('Phase 4 provisions the emulator with the exact sample data (AI mocked)', async ({
        vscodeApp,
        vscodeWindow,
    }) => {
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
        await stubMessageBoxButton(vscodeApp, 'Regenerate');
        try {
            await migration.populateSampleDataButton.click();
            await expect(migration.provisioningSummary).toBeVisible({ timeout: 60_000 });
        } finally {
            await resetNativeDialogStubs(vscodeApp);
        }
        await expect(migration.phaseCompleteBadge('phase4')).toBeVisible();

        // Summary reports the database + the single `orders` container.
        await expect(migration.provisioningSummary).toContainText('E2E Migration');
        await expect(migration.provisioningSummary).toContainText('orders');

        // Artifacts written to phases/4-provisioning/.
        await expect.poll(() => provisioningArtifactExists('sample-data.json'), { timeout: 10_000 }).toBe(true);
        await expect.poll(() => provisioningArtifactExists('seed-data.csh'), { timeout: 10_000 }).toBe(true);
        await expect
            .poll(() => provisioningArtifactExists('provisioning-verification.json'), { timeout: 10_000 })
            .toBe(true);

        // sample-data.json holds exactly the mocked items.
        const sample = readSampleData();
        expect(sample?.sampleData).toEqual([
            {
                containerName: 'orders',
                items: [
                    { id: 'order-1', customerId: 'c1', orderId: 1, total: 100, docType: 'order' },
                    { id: 'order-2', customerId: 'c2', orderId: 2, total: 250, docType: 'order' },
                ],
            },
        ]);

        // The emulator was actually provisioned with those exact two documents.
        const items = await readEmulatorItems('E2E Migration', 'orders');
        expect(items).toEqual([
            { id: 'order-1', customerId: 'c1', orderId: 1, total: 100, docType: 'order' },
            { id: 'order-2', customerId: 'c2', orderId: 2, total: 250, docType: 'order' },
        ]);

        const firstVerification = readMigrationJson<{ verifiedAt: string }>(
            'phases/4-provisioning/provisioning-verification.json',
        );
        await stubMessageBoxButton(vscodeApp, 'Reuse Existing');
        try {
            await migration.populateSampleDataButton.click();
            await expect
                .poll(
                    () =>
                        readMigrationJson<{ verifiedAt: string }>(
                            'phases/4-provisioning/provisioning-verification.json',
                        )?.verifiedAt,
                    { timeout: 60_000 },
                )
                .not.toBe(firstVerification?.verifiedAt);
        } finally {
            await resetNativeDialogStubs(vscodeApp);
        }
        await expect.poll(() => readEmulatorItems('E2E Migration', 'orders'), { timeout: 30_000 }).toEqual(items);
    });

    test('Migration action advances from Plan Migration after the plan is created', async ({ vscodeWindow }) => {
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

        // Click "Plan Migration" and verify the offline mock receives the generated
        // prompt, then simulate Chat writing the plan to disk. The file watcher
        // updates hasCodeMigrationPlan and advances the selected action.
        await migration.migrationActionButton.click();
        await expect
            .poll(() => readCapturedPrompts().some((p) => p.route === 'code-migration-plan'), { timeout: 15_000 })
            .toBe(true);
        await expect
            .poll(
                () => readCapturedPrompts().find((prompt) => prompt.route === 'code-migration-plan')?.promptText ?? '',
                { timeout: 15_000 },
            )
            .toContain('Artifact regeneration: required.');
        writeCodeMigrationPlanDraft();
        await expect(migration.viewPlanLink).toBeVisible({ timeout: 15_000 });
        await expect(migration.migrationActionButton).toContainText('Plan Migration');

        // Completing the validated checkpoint advances the next action to migration.
        writeCodeMigrationPlan();
        await expect(migration.migrationActionButton).toContainText('Migrate Application');
        await expect(migration.migrationActionButton).toBeEnabled();
    });
});
