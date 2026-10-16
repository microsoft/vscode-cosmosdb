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
 *   4. Skill flow — real WebView dispatch and strict state synchronization,
 *      with authenticated Chat replaced by deterministic fake-agent artifact writes.
 *
 * The seeded/AI flows rely on the `cosmosDB.e2e.openMigration*` test-only
 * commands and the `COSMOSDB_E2E_MIGRATION_AI_MOCK` env flag, both wired up by
 * the Playwright fixture in `test/e2e/fixtures/vscode.ts`.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { type ProjectJson } from '../../../src/services/MigrationProjectService';
import {
    addMockRegenerationSentinel,
    checkMockSkillPhaseCompletion,
    gitDirExists,
    MigrationPage,
    PHASE_HEADERS,
    provisioningArtifactExists,
    readApplicationFile,
    readCapturedPrompts,
    readGitignore,
    readMigrationArtifact,
    readMigrationJson,
    runMockSkillAgent,
    setMockSkillRunActivity,
} from '../fixtures/migration';
import { expect, test } from '../fixtures/vscode';
import { closeAllEditorTabs, resetNativeDialogStubs, stubMessageBoxButton } from '../fixtures/webviewHelpers';
import { openMigrationAssistant, openMigrationFresh, openMigrationSeeded } from '../fixtures/webviews';

test.describe('Migration Assistant', () => {
    // Worker-scoped VS Code is reused across tests; reset editor state so panels
    // from one test don't leak into the next. The e2e open commands also reset
    // the on-disk `.cosmosdb-migration` folder, keeping each test hermetic.
    test.afterEach(async ({ vscodeWindow, vscodeApp }) => {
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
        await expect(frame.getByRole('checkbox', { name: 'Enable thorough analysis' })).toHaveCount(0);
        await expect(frame.getByText(/Estimating tokens|Token estimate unavailable|^~.+ tokens$/)).toHaveCount(0);
    });

    test('locked phases explain prerequisites on hover and keyboard focus', async ({ vscodeWindow }, testInfo) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const reasons = [
            [PHASE_HEADERS.phase1, 'Complete Preflight before running Source Discovery.'],
            [PHASE_HEADERS.phase2, 'Complete Phase 1: Source Discovery first.'],
            [PHASE_HEADERS.phase3, 'Complete Phase 2: Domain Assessment first.'],
            [PHASE_HEADERS.phase4, 'Complete Phase 1: Source Discovery first.'],
        ] as const;

        for (const [label, reason] of reasons) {
            const header = frame.getByRole('button', { name: new RegExp(label) });
            await expect(header).toHaveText(label);
            await expect(header).toHaveAccessibleName(new RegExp(label));
            await expect(header).toHaveAccessibleDescription(reason);
            await expect(header.getByRole('img', { name: 'Locked', exact: true })).toBeVisible();
            await header.hover();
            const tooltip = frame.getByRole('tooltip', { name: reason, exact: true });
            await expect(tooltip).toBeVisible();
            await expect
                .poll(async () => {
                    const labelBox = await header.getByTestId(/migration-phase\d-label/).boundingBox();
                    const tooltipBox = await tooltip.boundingBox();
                    if (!labelBox || !tooltipBox) return false;
                    return (
                        tooltipBox.y + tooltipBox.height <= labelBox.y &&
                        Math.abs(tooltipBox.x + tooltipBox.width / 2 - (labelBox.x + labelBox.width / 2)) < 8
                    );
                })
                .toBe(true);
            await header.press('Escape');
            await expect(frame.getByRole('tooltip')).toHaveCount(0);
            await vscodeWindow.mouse.move(0, 0);
            await header.press('Tab');
            await vscodeWindow.keyboard.press('Shift+Tab');
            await expect(header).toBeFocused();
            await expect(frame.getByRole('tooltip', { name: reason, exact: true })).toBeVisible();
            await header.press('Escape');
            await expect(frame.getByRole('tooltip')).toHaveCount(0);
        }
        await frame.getByRole('button', { name: new RegExp(PHASE_HEADERS.phase3) }).hover();
        await expect(frame.getByRole('tooltip')).toBeVisible();
        await vscodeWindow.screenshot({ path: testInfo.outputPath('locked-phases.png') });
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

    test('required application details stay neutral until blurred', async ({ vscodeWindow }, testInfo) => {
        const frame = await openMigrationFresh(vscodeWindow);
        const migration = new MigrationPage(frame);
        const fields = ['project-name', 'project-type', 'language', 'database', 'access'] as const;

        await expect(frame.getByText('Required', { exact: true })).toHaveCount(0);
        for (const field of fields) {
            const input = migration.analysisField(field);
            await expect(input).toHaveAttribute('required', '');
            await expect(input).not.toHaveAttribute('aria-invalid', 'true');
            await input.focus();
            await input.fill('');
            await expect(input).not.toHaveAttribute('aria-invalid', 'true');
            await input.press('Tab');
            await expect(input).toHaveAttribute('aria-invalid', 'true');
            await expect(input).toHaveAccessibleDescription('Required');
            await expect(frame.getByText('Required', { exact: true })).toHaveCount(1);
            await input.fill('Example');
            await expect(input).not.toHaveAttribute('aria-invalid', 'true');
            await input.fill('   ');
            await expect(input).toHaveAttribute('aria-invalid', 'true');
            await input.fill('Example');
        }
        await expect(frame.getByText('Required', { exact: true })).toHaveCount(0);
        await migration.analysisField('frameworks').focus();
        await migration.analysisField('frameworks').press('Tab');
        await expect(migration.analysisField('frameworks')).not.toHaveAttribute('aria-invalid', 'true');
        await migration.root.screenshot({ path: testInfo.outputPath('application-details-validation.png') });
    });

    test('frameworks are optional and clearing them persists without a placeholder', async ({ vscodeWindow }) => {
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

    test('phase instructions persist in the checkpoint consumed by the Skill', async ({ vscodeWindow }) => {
        const frame = await openMigrationSeeded(vscodeWindow);
        const migration = new MigrationPage(frame);

        const marker = `e2e-marker-${Date.now()}`;
        await migration.instructions('discovery').fill(`Focus on the ${marker} domain.`);
        await expect
            .poll(() => readMigrationJson<ProjectJson>('project.json')?.phases.discovery.discoveryInstructions)
            .toBe(`Focus on the ${marker} domain.`);
    });

    test('starts Skill Discovery from launch preconditions without completed preflight', async ({ vscodeWindow }) => {
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
    });

    for (const [subfolder, label, heading] of [
        ['volumetrics', 'Open Volumetrics Template', 'Volumetrics'],
        ['access-patterns', 'Open Access-Patterns Template', 'Access Patterns'],
    ] as const) {
        for (const existing of [true, false]) {
            test(`opens ${existing ? 'existing' : 'missing'} ${subfolder} template during an active phase`, async ({
                vscodeWindow,
            }) => {
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
                }
            });
        }
    }

    test('resets active Skill status from its launch button without changing checkpoints', async ({
        vscodeWindow,
        vscodeApp,
    }) => {
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
        }
    });

    test('tracks Skill activity and reopens read-only without relaunching Chat', async ({
        vscodeWindow,
        vscodeApp,
    }, testInfo) => {
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

            await frame.evaluate(() => {
                const record = (message: string) =>
                    document.documentElement.setAttribute('data-migration-announcement', message);
                const target = document as Document & { ariaNotify?: (message: string, options?: unknown) => void };
                if (target.ariaNotify) {
                    const notify = target.ariaNotify.bind(target);
                    target.ariaNotify = (message, options) => {
                        record(message);
                        notify(message, options);
                    };
                } else {
                    new MutationObserver(() => {
                        const message = Array.from(document.querySelectorAll('[aria-live]'))
                            .map((element) => element.textContent)
                            .join(' ');
                        if (message.includes('Preflight: Blocked.')) record(message);
                    }).observe(document.body, { childList: true, subtree: true, characterData: true });
                }
            });
            setMockSkillRunActivity(prompt, 'blocked', 'Source schema needs review.');
            await expect(frame.locator('html')).toHaveAttribute('data-migration-announcement', /Preflight: Blocked\./);
            await expect(frame.getByTestId('migration-run-activity')).toHaveCount(0);
            await expect(migration.autoDetectButton).toBeEnabled();
            const blockedBytes = readMigrationArtifact('project.json');
            await closeAllEditorTabs(vscodeWindow);
            frame = await openMigrationAssistant(vscodeWindow);
            migration = new MigrationPage(frame);
            const diagnostics = frame.getByTestId('migration-preflight-diagnostics');
            const preflight = frame.getByTestId('migration-phase-preflight');
            await expect(preflight.getByTestId('migration-preflight-diagnostics')).toBeVisible();
            await expect(preflight.locator(':scope > :last-child')).toHaveAttribute(
                'data-testid',
                'migration-preflight-diagnostics',
            );
            await expect(diagnostics.getByText('Blocked', { exact: true })).toBeVisible();
            await expect(diagnostics.getByText('Source schema needs review.', { exact: true })).toBeVisible();
            const inventoryFailure = diagnostics
                .getByTestId('migration-diagnostic-failure')
                .filter({ hasText: 'Recorded source inventory evidence' });
            const inventoryToggle = inventoryFailure.getByRole('button', {
                name: 'Recorded source inventory evidence Invalid',
                exact: true,
            });
            await expect(inventoryToggle).toHaveAttribute('aria-expanded', 'false');
            await expect(inventoryToggle).toHaveAccessibleName('Recorded source inventory evidence Invalid');
            await inventoryToggle.focus();
            await inventoryToggle.press('Enter');
            await expect(inventoryToggle).toHaveAttribute('aria-expanded', 'true');
            await expect(inventoryFailure.getByText(/Choose and persist a DDL parsing method/)).toBeVisible();
            const schemaFailure = diagnostics
                .getByTestId('migration-diagnostic-failure')
                .filter({ hasText: 'Authoritative schema DDL' });
            const schemaToggle = schemaFailure.getByRole('button', {
                name: 'Authoritative schema DDL Invalid',
                exact: true,
            });
            await schemaToggle.click();
            await expect(inventoryToggle).toHaveAttribute('aria-expanded', 'true');
            await expect(schemaToggle).toHaveAttribute('aria-expanded', 'true');
            await expect(schemaFailure.getByRole('button', { name: 'Open Artifact', exact: true })).toBeVisible();
            await diagnostics.screenshot({ path: testInfo.outputPath('blocked-phase-expanded.png') });
            await inventoryToggle.press('Space');
            await expect(inventoryToggle).toHaveAttribute('aria-expanded', 'false');
            await schemaToggle.click();
            const restart = diagnostics.getByRole('button', { name: 'Review and Fix', exact: true });
            await expect(restart).toBeEnabled();
            await expect(restart).toHaveText('Review and Fix');
            await expect(restart).toHaveAccessibleName('Review and Fix');
            await expect(restart).toHaveAccessibleDescription(
                'Preflight: review blockers and propose fixes. Changes require your approval.',
            );
            expect(await restart.evaluate((element) => element.parentElement?.firstElementChild === element)).toBe(
                true,
            );
            const refreshBlocked = diagnostics.getByRole('button', { name: 'Refresh Status', exact: true });
            await refreshBlocked.click();
            await expect(refreshBlocked).toBeFocused();
            await expect(diagnostics.getByRole('button', { name: /Open (in )?Chat/ })).toHaveCount(0);
            expect(readCapturedPrompts()).toHaveLength(count);
            expect(readMigrationArtifact('project.json')).toBe(blockedBytes);
            await diagnostics.screenshot({ path: testInfo.outputPath('blocked-phase-desktop.png') });
            await vscodeWindow.setViewportSize({ width: 720, height: 900 });
            await expect(restart).toBeVisible();
            expect(await diagnostics.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
            await schemaToggle.click();
            await expect(schemaToggle).toHaveAttribute('aria-expanded', 'true');
            expect(await diagnostics.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
            await diagnostics.screenshot({ path: testInfo.outputPath('blocked-phase-narrow.png') });
            await vscodeWindow.setViewportSize(viewport);
            runMockSkillAgent(prompt);
            await expect(diagnostics).toHaveCount(0);
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
                if (phase === 'discovery' || phase === 'schema-conversion') {
                    const message =
                        phase === 'discovery'
                            ? 'The discovery evidence needs review.'
                            : 'The converted model needs repair.';
                    setMockSkillRunActivity(prompt, 'blocked', message);
                    const phaseSection = frame.getByTestId(`migration-phase-${phase}`);
                    await expect(
                        phaseSection.getByRole('button', {
                            name: /Phase (1: Source Discovery|3: Schema Conversion).*Blocked/,
                        }),
                    ).toBeVisible();
                    await expect(
                        phaseSection.getByTestId(`migration-phase${phase === 'discovery' ? 1 : 3}-status-complete`),
                    ).toHaveCount(0);
                    await expect(phaseSection.getByText(message, { exact: true })).toBeVisible();
                    const runButton = phaseSection.getByTestId(
                        phase === 'discovery' ? 'migration-run-discovery' : 'migration-run-conversion',
                    );
                    const runBounds = await runButton.boundingBox();
                    const failureBounds = await phaseSection
                        .getByTestId(`migration-${phase}-diagnostics`)
                        .boundingBox();
                    expect(runBounds).not.toBeNull();
                    expect(failureBounds).not.toBeNull();
                    expect(failureBounds!.y).toBeGreaterThanOrEqual(runBounds!.y + runBounds!.height);
                    await expect(activity).toHaveCount(0);
                    await expect(migration.modelDropdown).toBeEnabled();
                    if (phase === 'schema-conversion') {
                        const diagnostics = phaseSection.getByTestId('migration-schema-conversion-diagnostics');
                        const freshness = diagnostics.getByRole('button', {
                            name: 'Evidence freshness (4)',
                            exact: true,
                        });
                        await expect(diagnostics.getByRole('button', { name: /^Evidence freshness/ })).toHaveCount(1);
                        await expect(freshness).toHaveText('Evidence freshness (4)');
                        await expect(freshness).toHaveAccessibleName('Evidence freshness (4)');
                        await freshness.focus();
                        await freshness.press('Enter');
                        const reasons = diagnostics.getByRole('list', {
                            name: 'Evidence freshness (4)',
                            exact: true,
                        });
                        await expect(reasons).toContainText('Preflight / freshness-manifest:');
                        await expect(reasons).toContainText('Domain Assessment / freshness-manifest:');
                        await diagnostics.getByRole('button', { name: 'Refresh Status', exact: true }).click();
                        await expect(freshness).toHaveAttribute('aria-expanded', 'true');
                        await expect(
                            diagnostics.getByRole('button', { name: 'Review and Fix', exact: true }),
                        ).toBeEnabled();
                    }
                    await phaseSection.screenshot({ path: testInfo.outputPath(`blocked-${phase}.png`) });
                    continue;
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
        }
    });

    test('explains a stale upstream file without changing successful run history', async ({
        vscodeWindow,
    }, testInfo) => {
        const viewport =
            vscodeWindow.viewportSize() ??
            (await vscodeWindow.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight })));
        try {
            await openMigrationSeeded(vscodeWindow);
            const fixtures = pathToFileURL(
                path.resolve('skills/cosmosdb-relational-migration/tests/source-evidence-fixtures.mjs'),
            ).href;
            const freshness = pathToFileURL(
                path.resolve('skills/cosmosdb-relational-migration/scripts/freshness.mjs'),
            ).href;
            execFileSync(
                process.execPath,
                [
                    '--input-type=module',
                    '--eval',
                    `
                import fs from 'node:fs';
                import path from 'node:path';
                import { sourceFixture, discoveryFixture, assessmentFixture } from ${JSON.stringify(fixtures)};
                import { buildFreshnessManifest } from ${JSON.stringify(freshness)};
                const workspace = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
                const projectPath = path.join(workspace, '.cosmosdb-migration/project.json');
                const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
                const timestamp = new Date().toISOString();
                project.phases.discovery.status = 'complete';
                project.phases.discovery.schemaInventory = { files: ['phases/1-discovery/schema-ddl/Schema.sql'] };
                project.phases.discovery.applicationAnalysis.completedAt ??= timestamp;
                project.phases.assessment = { status: 'complete', completedAt: timestamp, domains: [
                    { name: 'Orders', tables: ['dbo.Orders'], crossDomainDependencies: [], isMapped: true }
                ] };
                const inventory = sourceFixture(workspace, project);
                discoveryFixture(workspace, inventory, project);
                assessmentFixture(workspace, project, inventory);
                project.freshness.assessment = buildFreshnessManifest(workspace, project, 'assessment', [
                    '.cosmosdb-migration/phases/1-discovery/discovery-report.md',
                    '.cosmosdb-migration/phases/1-discovery/access-patterns/access-patterns.md',
                    '.cosmosdb-migration/phases/1-discovery/volumetrics/volumetrics.md'
                ]);
                project.execution = { version: 1, runId: 'stale-evidence-review', phase: 'assessment', step: null,
                    activity: 'complete', startedAt: timestamp, updatedAt: timestamp, detail: 'Assessment complete.' };
                fs.writeFileSync(projectPath, JSON.stringify(project));
            `,
                ],
                { env: process.env },
            );
            const checkpoint = readMigrationArtifact('project.json');
            await closeAllEditorTabs(vscodeWindow);
            let frame = await openMigrationAssistant(vscodeWindow);
            let assessment = frame.getByTestId('migration-phase-assessment');
            await assessment.getByRole('button', { name: /Phase 2: Domain Assessment/ }).click();
            await expect(assessment.getByTestId('migration-phase2-status-complete')).toBeVisible();
            const completedAssessmentHeader = assessment.getByRole('button', {
                name: new RegExp(PHASE_HEADERS.phase2),
            });
            await expect(completedAssessmentHeader.getByRole('img', { name: 'Complete', exact: true })).toBeVisible();
            await expect(completedAssessmentHeader.getByText('Complete', { exact: true })).toHaveCount(0);
            await expect(completedAssessmentHeader).not.toHaveAttribute('aria-description');
            await completedAssessmentHeader.screenshot({ path: testInfo.outputPath('completed-phase-header.png') });
            const relative = 'phases/1-discovery/volumetrics/volumetrics.md';
            appendFileSync(path.join(process.env.COSMOSDB_E2E_WORKSPACE_DIR!, '.cosmosdb-migration', relative), ' ');
            const diagnostics = assessment.getByTestId('migration-assessment-diagnostics');
            await expect(diagnostics.getByText('Stale evidence', { exact: true })).toBeVisible();
            await expect(diagnostics.getByText('Blocked', { exact: true })).toHaveCount(0);
            await expect(diagnostics.getByText('Last run: Assessment complete.', { exact: true })).toBeVisible();
            await expect(diagnostics.getByText(/Required prerequisite: Preflight/)).toHaveCount(0);
            await diagnostics.getByRole('button', { name: 'Evidence freshness (1)', exact: true }).click();
            await expect(diagnostics.getByTestId('migration-freshness-cause')).toHaveCount(1);
            await expect(diagnostics.getByRole('list', { name: 'Evidence freshness (1)', exact: true })).toContainText(
                'Preflight / volumetrics.md: recorded input no longer matches current content',
            );
            await expect(diagnostics.locator(':scope > [data-testid="migration-freshness-cause"]')).toHaveCount(0);
            await expect(diagnostics.getByRole('textbox', { name: 'Evidence freshness (1)', exact: true })).toHaveCount(
                0,
            );
            const promptCount = readCapturedPrompts().length;
            await diagnostics.getByRole('button', { name: 'Go to Preflight', exact: true }).click();
            await expect(frame.getByTestId('migration-phase-preflight').getByRole('button').first()).toBeFocused();
            await diagnostics.screenshot({ path: testInfo.outputPath('stale-volumetrics-desktop.png') });
            await vscodeWindow.setViewportSize({ width: 720, height: 900 });
            expect(await diagnostics.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
            await diagnostics.screenshot({ path: testInfo.outputPath('stale-volumetrics-narrow.png') });
            await vscodeWindow.setViewportSize(viewport);
            const fileLink = diagnostics.getByRole('button', { name: 'volumetrics.md', exact: true });
            await expect(fileLink).toHaveAccessibleName('volumetrics.md');
            await expect(fileLink).toHaveAccessibleDescription(`.cosmosdb-migration/${relative}`);
            await fileLink.focus();
            await fileLink.press('Enter');
            await expect(vscodeWindow.getByRole('tab', { name: /volumetrics\.md/ })).toBeVisible();
            await expect(vscodeWindow.getByRole('code')).toBeVisible();
            await expect(vscodeWindow.getByRole('code').locator('.view-lines')).toContainText('Volumetrics');
            await closeAllEditorTabs(vscodeWindow);
            frame = await openMigrationAssistant(vscodeWindow);
            assessment = frame.getByTestId('migration-phase-assessment');
            await assessment.getByRole('button', { name: /Phase 2: Domain Assessment/ }).click();
            await expect(
                assessment.getByTestId('migration-assessment-diagnostics').getByText('Stale evidence', { exact: true }),
            ).toBeVisible();
            expect(readMigrationArtifact('project.json')).toBe(checkpoint);
            expect(readCapturedPrompts()).toHaveLength(promptCount);
            execFileSync(
                process.execPath,
                [
                    '--input-type=module',
                    '--eval',
                    `
                import fs from 'node:fs';
                import path from 'node:path';
                import { buildFreshnessManifest } from ${JSON.stringify(freshness)};
                const workspace = process.env.COSMOSDB_E2E_WORKSPACE_DIR;
                const root = path.join(workspace, '.cosmosdb-migration');
                const projectPath = path.join(root, 'project.json');
                const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
                for (const file of ['discovery-manifest.json', 'discovery-report.md', 'access-patterns/access-patterns.md']) {
                    fs.appendFileSync(path.join(root, 'phases/1-discovery', file), ' ');
                }
                project.freshness.preflight = buildFreshnessManifest(workspace, project, 'preflight');
                project.freshness.discovery = buildFreshnessManifest(workspace, project, 'discovery');
                const timestamp = new Date().toISOString();
                project.execution = { version: 1, runId: 'discovery-rerun-review', phase: 'discovery', step: null,
                    activity: 'complete', startedAt: timestamp, updatedAt: timestamp, detail: 'Discovery rerun complete.' };
                fs.writeFileSync(projectPath, JSON.stringify(project));
            `,
                ],
                { env: process.env },
            );
            await expect(frame.getByTestId('migration-phase1-status-complete')).toBeVisible();
            const currentDiagnostics = assessment.getByTestId('migration-assessment-diagnostics');
            const currentFreshness = currentDiagnostics.getByRole('button', {
                name: 'Evidence freshness (4)',
                exact: true,
            });
            if ((await currentFreshness.getAttribute('aria-expanded')) !== 'true') await currentFreshness.click();
            const currentList = currentDiagnostics.getByRole('list', { name: 'Evidence freshness (4)', exact: true });
            await expect(currentList.getByTestId('migration-freshness-cause')).toHaveCount(4);
            await expect(currentDiagnostics.getByRole('textbox', { name: /^Evidence freshness/ })).toHaveCount(0);
            await expect(currentDiagnostics.getByRole('button', { name: /^Open .*\.(md|json)$/ })).toHaveCount(0);
            for (const file of [
                'discovery-manifest.json',
                'discovery-report.md',
                'access-patterns.md',
                'volumetrics.md',
            ]) {
                const link = currentList.getByRole('button', { name: file, exact: true });
                await expect(link).toHaveCount(1);
                await expect(link).toHaveAccessibleName(file);
            }
            const refreshedCheckpoint = readMigrationArtifact('project.json');
            await currentDiagnostics.screenshot({
                path: testInfo.outputPath('assessment-freshness-links-desktop.png'),
            });
            await vscodeWindow.setViewportSize({ width: 720, height: 900 });
            expect(await currentList.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
            await currentDiagnostics.screenshot({ path: testInfo.outputPath('assessment-freshness-links-narrow.png') });
            expect(readMigrationArtifact('project.json')).toBe(refreshedCheckpoint);
            expect(readCapturedPrompts()).toHaveLength(promptCount);
        } finally {
            await vscodeWindow.setViewportSize(viewport);
        }
    });

    test('groups phase errors into one keyboard-scrollable expander', async ({ vscodeWindow }, testInfo) => {
        const viewport =
            vscodeWindow.viewportSize() ??
            (await vscodeWindow.evaluate(() => ({
                width: window.innerWidth,
                height: window.innerHeight,
            })));
        try {
            const frame = await openMigrationSeeded(vscodeWindow);
            const project = readMigrationJson<{ phases: Record<string, unknown> }>('project.json')!;
            project.phases.assessment = {
                status: 'complete',
                parsedAccessPatterns: Array.from({ length: 80 }, (_, index) => ({
                    name: `Pattern ${index}`,
                    type: 'read',
                    frequency: 'daily',
                    tables: ['dbo.Orders'],
                    codeReferences: [],
                    singleOrBatch: 42,
                })),
            };
            const checkpoint = `${JSON.stringify(project, null, 2)}\n`;
            writeFileSync(
                path.join(process.env.COSMOSDB_E2E_WORKSPACE_DIR!, '.cosmosdb-migration/project.json'),
                checkpoint,
            );
            const phase = frame.getByTestId('migration-phase-assessment');
            await phase.getByRole('button', { name: /Phase 2: Domain Assessment/ }).click();
            const diagnostics = phase.getByTestId('migration-assessment-diagnostics');
            await expect(diagnostics.getByText('Project validation failed', { exact: true })).toBeVisible();
            await expect(diagnostics.getByText('Evidence not verified', { exact: true })).toHaveCount(0);
            await expect(diagnostics.getByText(/Required prerequisite:/)).toHaveCount(0);
            await expect(diagnostics.getByRole('button', { name: /^Evidence freshness/ })).toHaveCount(0);
            await expect(diagnostics.getByRole('button', { name: 'Restart Generation', exact: true })).toHaveCount(0);
            await expect(diagnostics.getByRole('button', { name: 'Review and Fix', exact: true })).toBeEnabled();
            await expect(
                diagnostics.getByText('Resolve the project validation errors, then refresh status.', { exact: true }),
            ).toBeVisible();
            const toggle = diagnostics.getByRole('button', { name: 'Errors (80)', exact: true });
            await expect(toggle).toHaveCount(1);
            await expect(toggle).toHaveText('Errors (80)');
            await expect(toggle).toHaveAccessibleName('Errors (80)');
            await expect(toggle).toHaveAttribute('aria-expanded', 'false');
            await expect(diagnostics.getByRole('button', { name: 'Next diagnostics', exact: true })).toHaveCount(0);
            await toggle.focus();
            await toggle.press('Enter');
            const list = diagnostics.getByRole('textbox', { name: 'Errors (80)', exact: true });
            await expect(list).toBeVisible();
            await expect(list).toHaveJSProperty('readOnly', true);
            expect((await list.inputValue()).split('\n')).toHaveLength(80);
            const dimensions = await list.evaluate((element) => ({
                height: element.clientHeight,
                content: element.scrollHeight,
            }));
            expect(dimensions.height).toBeLessThanOrEqual(240);
            expect(dimensions.content).toBeGreaterThan(dimensions.height);
            await list.focus();
            await expect(list).toBeFocused();
            await list.press('PageDown');
            await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
            await list.evaluate((element) => {
                element.scrollTop = element.scrollHeight;
            });
            const scrollTop = await list.evaluate((element) => element.scrollTop);
            await diagnostics.getByRole('button', { name: 'Refresh Status', exact: true }).click();
            await expect(toggle).toHaveAttribute('aria-expanded', 'true');
            await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(scrollTop);
            expect(readMigrationArtifact('project.json')).toBe(checkpoint);
            await diagnostics.screenshot({ path: testInfo.outputPath('grouped-errors-desktop.png') });
            await vscodeWindow.setViewportSize({ width: 720, height: 900 });
            await expect(list).toBeVisible();
            expect(await list.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
            expect(await diagnostics.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
            await diagnostics.screenshot({ path: testInfo.outputPath('grouped-errors-narrow.png') });
        } finally {
            await vscodeWindow.setViewportSize(viewport);
        }
    });

    test('observes historical completion read-only and reviews blockers before approval', async ({
        vscodeWindow,
    }, testInfo) => {
        let frame = await openMigrationSeeded(vscodeWindow);
        const project = readMigrationJson<{ phases: Record<string, unknown> }>('project.json')!;
        project.phases.assessment = {
            status: 'complete',
            completedAt: '2026-05-18T10:37:56.400Z',
            parsedAccessPatterns: [
                {
                    name: 'Read Orders',
                    type: 'read',
                    frequency: 'daily',
                    tables: ['dbo.Orders'],
                    codeReferences: [],
                    singleOrBatch: null,
                    codeExample: null,
                },
            ],
        };
        Object.assign(project, { futureMetadata: { preserved: true } });
        const checkpoint = `${JSON.stringify(project, null, 2)}\n`;
        const root = path.join(process.env.COSMOSDB_E2E_WORKSPACE_DIR!, '.cosmosdb-migration');
        const summaryPath = 'phases/2-assessment/assessment-summary.md';
        const summary = '# Historical assessment\n\nEarlier results retained for inspection.\n';
        mkdirSync(path.join(root, 'phases/2-assessment'), { recursive: true });
        writeFileSync(path.join(root, summaryPath), summary);
        writeFileSync(path.join(root, 'project.json'), checkpoint);
        await closeAllEditorTabs(vscodeWindow);
        frame = await openMigrationAssistant(vscodeWindow);
        const phase = frame.getByTestId('migration-phase-assessment');
        await phase.getByRole('button', { name: /Phase 2: Domain Assessment/ }).click();
        const diagnostics = phase.getByTestId('migration-assessment-diagnostics');
        await expect(diagnostics.getByTestId('migration-recorded-completion')).toContainText('Recorded as complete on');
        await expect(diagnostics.getByTestId('migration-recorded-completion')).toContainText(
            'Not verified for the current Skill workflow.',
        );
        await expect(diagnostics.getByTestId('migration-compatibility-notice')).toContainText(
            '2 empty optional fields',
        );
        await expect(phase.getByTestId('migration-phase2-status-complete')).toHaveCount(0);
        await expect(diagnostics.getByText('Project validation failed', { exact: true })).toHaveCount(0);
        await diagnostics.getByRole('button', { name: 'Compatibility adjustments (2)', exact: true }).click();
        await expect(
            diagnostics.getByRole('textbox', { name: 'Compatibility adjustments (2)', exact: true }),
        ).toHaveJSProperty('readOnly', true);
        expect(
            await diagnostics.getByRole('textbox', { name: 'Compatibility adjustments (2)', exact: true }).inputValue(),
        ).toContain('/phases/assessment/parsedAccessPatterns/0/singleOrBatch');
        const promptCount = readCapturedPrompts().length;
        await diagnostics.getByRole('button', { name: 'Refresh Status', exact: true }).click();
        expect(readMigrationArtifact('project.json')).toBe(checkpoint);
        expect(readMigrationArtifact(summaryPath)).toBe(summary);
        expect(readCapturedPrompts()).toHaveLength(promptCount);
        const review = diagnostics.getByRole('button', { name: 'Review and Fix', exact: true });
        await expect(review).toBeEnabled();
        await expect(review).toHaveAccessibleName('Review and Fix');
        await expect(review).toHaveAccessibleDescription(
            'Domain Assessment: review blockers and propose fixes. Changes require your approval.',
        );
        expect(await review.evaluate((element) => element.parentElement?.firstElementChild === element)).toBe(true);
        await diagnostics.screenshot({ path: testInfo.outputPath('historical-completion.png') });
        await review.click();
        await expect.poll(() => readCapturedPrompts().length).toBe(promptCount + 1);
        const request = readCapturedPrompts().at(-1)!;
        expect(request.route).toBe('skill-assessment');
        expect(request.promptText).toContain(
            'Review the assessment migration blockers and propose fixes for approval.',
        );
        expect(request.promptText).toContain('Do not change files or resources before explicit approval.');
        expect(request.promptText).not.toMatch(/Regenerate|Allow provisioning/);
        expect(request.chat?.newSession).toBe(true);
        await expect(frame.getByTestId('migration-run-activity')).toHaveCount(0);
        expect(readMigrationArtifact('project.json')).toBe(checkpoint);
        expect(readMigrationArtifact(summaryPath)).toBe(summary);
    });

    test('preserves Auto across UX sessions and supports explicit model changes', async ({ vscodeWindow }) => {
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
        await expect(migration.modelDropdown).toContainText('Auto');
        await expect(frame.getByText(/Estimating tokens|Token estimate unavailable|^~.+ tokens$/)).toHaveCount(0);

        await closeAllEditorTabs(vscodeWindow);
        frame = await openMigrationAssistant(vscodeWindow);
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
        await migration.modelDropdown.click();
        await frame.getByRole('option', { name: /E2E Mock Model/ }).click();
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
    });

    test('drives Skill-first preflight through code migration with a mocked agent', async ({ vscodeWindow }) => {
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
                () => readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-discovery')?.promptText ?? '',
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
            .poll(() => readMigrationJson<{ migrationInstructions?: string }>('project.json')?.migrationInstructions, {
                timeout: 15_000,
            })
            .toBe(crossProducerMarker);

        await migration.expandPhase(PHASE_HEADERS.phase2);
        await expect(migration.runAssessmentButton()).toBeEnabled();
        await migration.runAssessmentButton().click();
        await expect
            .poll(
                () => readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-assessment')?.promptText ?? '',
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
            readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-schema-conversion')?.promptText ?? '',
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
            .poll(() => readCapturedPrompts().filter((prompt) => prompt.route === 'skill-schema-conversion').length, {
                timeout: 15_000,
            })
            .toBeGreaterThan(conversionPromptCount);
        const conversionRegenerationPrompt = readCapturedPrompts().findLast(
            (prompt) => prompt.route === 'skill-schema-conversion',
        );
        runMockSkillAgent(conversionRegenerationPrompt?.promptText ?? '');
        expect(readMigrationArtifact('phases/3-schema-conversion/summary.md')).not.toContain('REGENERATION-SENTINEL');
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
                    readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-provisioning')?.promptText ?? '',
                { timeout: 15_000 },
            )
            .toContain('Run only the resources-and-data provisioning step.');
        const provisioningPrompt = readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-provisioning');
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
                    readCapturedPrompts().findLast((prompt) => prompt.route === 'skill-code-migration')?.promptText ??
                    '',
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
        expect(skillDispatches.every((prompt) => prompt.chat?.modelSelector.id === 'e2e-mock-migration-model')).toBe(
            true,
        );
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
});
