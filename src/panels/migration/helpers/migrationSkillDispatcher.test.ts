/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Mock } from 'vitest';
import * as vscode from 'vscode';
import { MigrationProjectService } from '../../../services/MigrationProjectService';
import { getAvailableModelsInfo } from '../../../utils/aiUtils';
import { capturePrompt, isMigrationAiMockEnabled } from './e2eMigrationAiMock';
import {
    buildMigrationSkillPrompt,
    MigrationSkillChatSession,
    type MigrationSkillInvocation,
    shouldUseMigrationSkill,
} from './migrationSkillDispatcher';

vi.mock('../../../utils/aiUtils', () => ({ getAvailableModelsInfo: vi.fn() }));

vi.mock('./e2eMigrationAiMock', () => ({
    capturePrompt: vi.fn(),
    isMigrationAiMockEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('vscode', () => ({
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    FileType: { File: 1, Directory: 2 },
    commands: {
        executeCommand: vi.fn().mockResolvedValue(undefined),
        getCommands: vi.fn().mockResolvedValue([]),
    },
    workspace: {
        getConfiguration: vi.fn(),
        fs: { stat: vi.fn() },
    },
}));

describe('migrationSkillDispatcher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(vscode.workspace.fs.stat).mockRejectedValue(new Error('File not found'));
        vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);
        vi.mocked(vscode.commands.getCommands).mockResolvedValue([]);
        vi.mocked(getAvailableModelsInfo).mockResolvedValue({
            models: ['auto', 'selected'].map((id) => ({
                id,
                name: id,
                vendor: 'copilot',
                family: id,
                maxInputTokens: 128_000,
            })),
            savedModelId: null,
        });
        vi.mocked(isMigrationAiMockEnabled).mockReturnValue(false);
        (vscode.workspace.getConfiguration as Mock).mockReturnValue({ get: vi.fn().mockReturnValue(false) });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function mockArtifacts(...files: string[]): void {
        vi.mocked(vscode.workspace.fs.stat).mockImplementation(async (uri) => {
            if (files.includes(uri.fsPath)) {
                return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 1 };
            }
            throw new Error('File not found');
        });
    }

    it('uses the migration Skill by default', () => {
        expect(shouldUseMigrationSkill()).toBe(true);
        expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('cosmosDB');
    });

    it('uses the programmatic fallback when explicitly configured', () => {
        (vscode.workspace.getConfiguration as Mock).mockReturnValue({ get: vi.fn().mockReturnValue(true) });

        expect(shouldUseMigrationSkill()).toBe(false);
    });

    it('builds a minimal workspace invocation by default', () => {
        const prompt = buildMigrationSkillPrompt({ workspacePath: '/workspace/shop' });

        expect(prompt).toBe(
            [
                'Run a relational database migration to Azure Cosmos DB.',
                'Use the cosmosdb-relational-migration skill.',
            ].join('\n'),
        );
    });

    it('supplies only phase routing inputs for WebView-triggered runs', () => {
        const prompt = buildMigrationSkillPrompt({
            workspacePath: '/workspace/shop',
            mode: 'interactive',
            phase: 'assessment',
        });

        expect(prompt).toBe(
            [
                'Run the assessment phase of a relational database migration to Azure Cosmos DB.',
                'Use the cosmosdb-relational-migration skill.',
            ].join('\n'),
        );
    });

    it.each([
        ['preflight', 'preflight'],
        ['discovery', 'discovery'],
        ['assessment', 'assessment'],
        ['schema-conversion', 'schema conversion'],
        ['provisioning', 'provisioning'],
    ] as const)('regenerates %s only when its artifacts are known to exist', (phase, label) => {
        const invocation = { workspacePath: '/workspace/shop', phase };

        expect(buildMigrationSkillPrompt(invocation)).toContain(`Run the ${label} phase`);
        expect(buildMigrationSkillPrompt(invocation, true)).toContain(`Regenerate the ${label} results`);
    });

    it('does not request blanket regeneration for an unscoped run', () => {
        expect(buildMigrationSkillPrompt({ workspacePath: '/workspace/shop' }, true)).not.toContain('Regenerate');
    });

    it('keeps the run identifier on a separate final line', () => {
        const prompt = buildMigrationSkillPrompt({ workspacePath: '/workspace/shop', runId: 'run-123' });

        expect(prompt.split('\n').at(-1)).toBe('Run ID: run-123');
        expect(prompt).not.toContain('/workspace/shop');
    });

    it('uses persisted phase instructions without asking the agent to rewrite them', () => {
        const prompt = buildMigrationSkillPrompt({
            workspacePath: '/workspace/shop',
            mode: 'autonomous',
            phase: 'schema-conversion',
            allowProvisioning: true,
        });

        expect(prompt).toContain('Run the schema conversion phase');
        expect(prompt).toContain('Run in autonomous mode.');
        expect(prompt).toContain('Allow provisioning for this invocation.');
        expect(prompt).not.toContain('project.json');
    });

    it('focuses a preflight invocation without treating the step as additional instructions', () => {
        const prompt = buildMigrationSkillPrompt({
            workspacePath: '/workspace/shop',
            phase: 'preflight',
            preflightStep: 'volumetrics',
        });

        expect(prompt).toContain('Run the preflight phase');
        expect(prompt).toContain('Run only the volumetrics preflight step.');
        expect(prompt).not.toContain('readiness gate');
    });

    it('does not infer assessment artifacts from the phase alone', () => {
        const prompt = buildMigrationSkillPrompt({
            workspacePath: '/workspace/shop',
            mode: 'interactive',
            phase: 'assessment',
        });

        expect(prompt).toContain('Run the assessment phase');
        expect(prompt).not.toContain('project.json');
    });

    it('builds an adaptive schema-conversion invocation without an analysis mode', () => {
        const prompt = buildMigrationSkillPrompt({
            workspacePath: '/workspace/shop',
            phase: 'schema-conversion',
            includeUnmappedDomains: true,
        });

        expect(prompt).toContain('Run the schema conversion phase');
        expect(prompt).toContain('Include unmapped domains.');
        expect(prompt).not.toMatch(/fast|thorough/iu);
    });

    it('builds an explicitly authorized focused provisioning invocation', () => {
        const prompt = buildMigrationSkillPrompt({
            workspacePath: '/workspace/shop',
            phase: 'provisioning',
            provisioningStep: 'resources-and-data',
            allowProvisioning: true,
        });

        expect(prompt).toContain('Run the provisioning phase');
        expect(prompt).toContain('Run only the resources-and-data provisioning step.');
        expect(prompt).toContain('Allow provisioning for this invocation.');
        expect(prompt).not.toContain('recompute provisioning completion');
    });

    it('rejects focused provisioning without explicit authorization', () => {
        expect(() =>
            buildMigrationSkillPrompt({
                workspacePath: '/workspace/shop',
                phase: 'provisioning',
                provisioningStep: 'resources-and-data',
            }),
        ).toThrow(/explicit authorization/u);
    });

    it('rejects provisioning steps outside the provisioning phase', () => {
        expect(() =>
            buildMigrationSkillPrompt({
                workspacePath: '/workspace/shop',
                phase: 'assessment',
                provisioningStep: 'target-account',
                allowProvisioning: true,
            }),
        ).toThrow(/requires phase provisioning/u);
    });

    it('asks the Skill to plan without exposing a mode parameter', () => {
        const prompt = buildMigrationSkillPrompt({
            workspacePath: '/workspace/shop',
            phase: 'code-migration',
            codeMigrationAction: 'plan',
        });

        expect(prompt).toContain('Run the code migration phase');
        expect(prompt).toContain('Create the application code migration plan.');
        expect(prompt).not.toContain('execution blocker');
        expect(prompt).not.toContain('Do not modify application files');
        expect(prompt).not.toContain('code migration mode');
        expect(prompt).not.toContain('project.json');
        expect(prompt).not.toContain('Allow provisioning');
    });

    it('asks the Skill to migrate immediately', () => {
        const prompt = buildMigrationSkillPrompt({
            workspacePath: '/workspace/shop',
            phase: 'code-migration',
            codeMigrationAction: 'migrate',
        });

        expect(prompt).toContain('Migrate the application code using the validated migration plan.');
        expect(prompt).not.toContain('code migration mode');
    });

    it('defaults a code-migration invocation to planning', () => {
        const prompt = buildMigrationSkillPrompt({
            workspacePath: '/workspace/shop',
            phase: 'code-migration',
        });

        expect(prompt).toContain('Create the application code migration plan.');
    });

    it('updates an existing code migration plan without requesting application changes', () => {
        const prompt = buildMigrationSkillPrompt(
            { workspacePath: '/workspace/shop', phase: 'code-migration', codeMigrationAction: 'plan' },
            true,
        );

        expect(prompt).toContain('Update the application code migration plan.');
        expect(prompt).not.toContain('Regenerate');
        expect(prompt).not.toContain('Migrate the application code');
    });

    it('keeps code execution explicit even when earlier outputs exist', () => {
        const prompt = buildMigrationSkillPrompt(
            { workspacePath: '/workspace/shop', phase: 'code-migration', codeMigrationAction: 'migrate' },
            true,
        );

        expect(prompt).toContain('Migrate the application code using the validated migration plan.');
        expect(prompt).not.toContain('Regenerate');
    });

    it('rejects a code migration action outside the code-migration phase', () => {
        expect(() =>
            buildMigrationSkillPrompt({
                workspacePath: '/workspace/shop',
                phase: 'assessment',
                codeMigrationAction: 'plan',
            }),
        ).toThrow(/requires phase code-migration/u);
    });

    it('opens Copilot Chat in Agent mode with the built prompt', async () => {
        const invocation = { workspacePath: '/workspace/shop', phase: 'discovery' as const };
        const query = await new MigrationSkillChatSession().dispatch(invocation, 'selected');

        expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(1, 'workbench.action.chat.newChat');
        expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(2, 'workbench.action.chat.open', {
            mode: 'agent',
            query,
            modelSelector: { vendor: 'copilot', id: 'selected' },
        });
        expect(query).toBe(buildMigrationSkillPrompt(invocation));
    });

    it.each([
        ['preflight', 'phases/1-discovery/preflight-manifest.json'],
        ['discovery', 'phases/1-discovery/discovery-report.md'],
        ['assessment', 'phases/2-assessment/assessment-summary.md'],
        ['schema-conversion', 'phases/3-schema-conversion/model.json'],
        ['provisioning', 'phases/4-provisioning/sample-data.json'],
    ] as const)('detects existing %s outputs before dispatch', async (phase, artifact) => {
        mockArtifacts(`/workspace/shop/.cosmosdb-migration/${artifact}`);
        const invocation = { workspacePath: '/workspace/shop', phase };

        const query = await new MigrationSkillChatSession().dispatch(invocation, 'selected');

        expect(query).toBe(buildMigrationSkillPrompt(invocation, true));
    });

    it.each(['discovery', 'assessment', 'schema-conversion'] as const)(
        'does not regenerate %s just because preflight outputs exist',
        async (phase) => {
            mockArtifacts('/workspace/shop/.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');
            const invocation = { workspacePath: '/workspace/shop', phase };

            const query = await new MigrationSkillChatSession().dispatch(invocation, 'selected');

            expect(query).toBe(buildMigrationSkillPrompt(invocation));
        },
    );

    it.each([
        ['volumetrics', 'volumetrics/volumetrics.md'],
        ['access-patterns', 'access-patterns/access-patterns.md'],
    ] as const)('checks only the requested %s preflight output', async (preflightStep, artifact) => {
        const invocation: MigrationSkillInvocation = {
            workspacePath: '/workspace/shop',
            phase: 'preflight',
            preflightStep,
        };
        const session = new MigrationSkillChatSession();
        mockArtifacts('/workspace/shop/.cosmosdb-migration/phases/1-discovery/preflight-manifest.json');

        expect(await session.dispatch(invocation, 'selected')).toBe(buildMigrationSkillPrompt(invocation));
        mockArtifacts(`/workspace/shop/.cosmosdb-migration/phases/1-discovery/${artifact}`);
        expect(await session.dispatch(invocation, 'selected')).toBe(buildMigrationSkillPrompt(invocation, true));
    });

    it('recognizes completed application analysis without using unrelated preflight files', async () => {
        const load = vi.spyOn(MigrationProjectService.prototype, 'load').mockResolvedValue(undefined);
        const invocation: MigrationSkillInvocation = {
            workspacePath: '/workspace/shop',
            phase: 'preflight',
            preflightStep: 'application-details',
        };
        const session = new MigrationSkillChatSession();

        expect(await session.dispatch(invocation, 'selected')).toBe(buildMigrationSkillPrompt(invocation));
        load.mockResolvedValue({
            version: 1,
            name: 'shop',
            sourceCode: 'parent',
            phases: {
                discovery: { status: 'not-started', applicationAnalysis: { completedAt: '2026-10-08T00:00:00Z' } },
            },
        });
        expect(await session.dispatch(invocation, 'selected')).toBe(buildMigrationSkillPrompt(invocation, true));
        expect(load).toHaveBeenLastCalledWith({ readOnly: true });
    });

    it.each([
        { phase: 'preflight', preflightStep: 'schema-acquisition' },
        { phase: 'provisioning', provisioningStep: 'target-account', allowProvisioning: true },
    ] satisfies Partial<MigrationSkillInvocation>[])(
        'does not regenerate input or target configuration for %j',
        async (scope) => {
            const invocation = { workspacePath: '/workspace/shop', ...scope };
            const query = await new MigrationSkillChatSession().dispatch(invocation, 'selected');

            expect(query).toBe(buildMigrationSkillPrompt(invocation));
            expect(vscode.workspace.fs.stat).not.toHaveBeenCalled();
        },
    );

    it('does not infer resource-and-data outputs from account deployment files', async () => {
        const invocation: MigrationSkillInvocation = {
            workspacePath: '/workspace/shop',
            phase: 'provisioning',
            provisioningStep: 'resources-and-data',
            allowProvisioning: true,
        };
        const session = new MigrationSkillChatSession();
        mockArtifacts(
            '/workspace/shop/.cosmosdb-migration/phases/4-provisioning/main.bicep',
            '/workspace/shop/.cosmosdb-migration/phases/4-provisioning/main.bicepparam',
            '/workspace/shop/.cosmosdb-migration/phases/4-provisioning/summary.md',
            '/workspace/shop/.cosmosdb-migration/phases/4-provisioning/manifest.json',
        );

        expect(await session.dispatch(invocation, 'selected')).toBe(buildMigrationSkillPrompt(invocation));
        mockArtifacts('/workspace/shop/.cosmosdb-migration/phases/4-provisioning/sample-data.json');
        expect(await session.dispatch(invocation, 'selected')).toBe(buildMigrationSkillPrompt(invocation, true));
    });

    it('checks for the code migration plan before choosing create or update', async () => {
        const invocation: MigrationSkillInvocation = { workspacePath: '/workspace/shop', phase: 'code-migration' };
        const session = new MigrationSkillChatSession();
        mockArtifacts('/workspace/shop/.cosmosdb-migration/code-migration-manifest.json');

        expect(await session.dispatch(invocation, 'selected')).toContain('Create the application code migration plan.');
        mockArtifacts('/workspace/shop/.cosmosdb-migration/code-migration-plan.md');
        expect(await session.dispatch(invocation, 'selected')).toContain('Update the application code migration plan.');
    });

    it('does not count directories as generated artifacts', async () => {
        vi.mocked(vscode.workspace.fs.stat).mockResolvedValue({
            type: vscode.FileType.Directory,
            ctime: 0,
            mtime: 0,
            size: 0,
        });
        const invocation: MigrationSkillInvocation = { workspacePath: '/workspace/shop', phase: 'assessment' };

        expect(await new MigrationSkillChatSession().dispatch(invocation, 'selected')).toBe(
            buildMigrationSkillPrompt(invocation),
        );
    });

    it.each(['gpt-5.6-sol-fast', null])(
        'opens a local chat for the exact Fast variant with selection %s',
        async (selection) => {
            vi.mocked(vscode.commands.getCommands).mockResolvedValue([
                'workbench.action.chat.newChat',
                'workbench.action.chat.newLocalChat',
            ]);
            vi.mocked(getAvailableModelsInfo).mockResolvedValue({
                models: [
                    { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol (Internal only)' },
                    { id: 'gpt-5.6-sol-fast', name: 'GPT-5.6 Sol Fast (Internal only)' },
                ].map((model) => ({
                    ...model,
                    vendor: 'copilot',
                    family: 'gpt-5.6-sol',
                    maxInputTokens: 128_000,
                })),
                savedModelId: 'gpt-5.6-sol-fast',
            });

            const query = await new MigrationSkillChatSession().dispatch(
                { workspacePath: '/workspace/shop', phase: 'discovery' },
                selection,
            );

            expect(vscode.commands.getCommands).toHaveBeenCalledExactlyOnceWith(true);
            expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(1, 'workbench.action.chat.newLocalChat');
            expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith('workbench.action.chat.open', {
                mode: 'agent',
                query,
                modelSelector: { vendor: 'copilot', id: 'gpt-5.6-sol-fast' },
            });
        },
    );

    it('captures Skill prompts without opening Chat in E2E mock mode', async () => {
        vi.mocked(isMigrationAiMockEnabled).mockReturnValue(true);
        const invocation = { workspacePath: '/workspace/shop', phase: 'assessment' as const };
        const session = new MigrationSkillChatSession();
        const query = await session.dispatch(invocation, 'auto');

        expect(capturePrompt).toHaveBeenCalledWith('skill-assessment', query, {
            newSession: true,
            modelSelector: { vendor: 'copilot', id: 'auto' },
        });
        await session.dispatch(invocation, 'selected');
        expect(capturePrompt).toHaveBeenLastCalledWith('skill-assessment', query, {
            newSession: false,
            modelSelector: { vendor: 'copilot', id: 'selected' },
        });
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it.each(['workbench.action.chat.newChat', 'workbench.action.chat.newLocalChat'])(
        'initializes once using %s and applies the selection on every dispatch',
        async (newChatCommand) => {
            vi.mocked(vscode.commands.getCommands).mockResolvedValue([newChatCommand]);
            const session = new MigrationSkillChatSession();
            await session.dispatch({ workspacePath: '/shop', phase: 'preflight' }, 'auto');
            await session.dispatch({ workspacePath: '/shop', phase: 'discovery' }, 'selected');
            expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(3);
            expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(1, newChatCommand);
            expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(
                2,
                'workbench.action.chat.open',
                expect.objectContaining({ modelSelector: { vendor: 'copilot', id: 'auto' } }),
            );
            expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(
                3,
                'workbench.action.chat.open',
                expect.objectContaining({ modelSelector: { vendor: 'copilot', id: 'selected' } }),
            );
            await new MigrationSkillChatSession().dispatch({ workspacePath: '/shop' }, 'selected');
            expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(4, newChatCommand);
        },
    );

    it('does not create Chat or submit when the selected model is unavailable', async () => {
        await expect(new MigrationSkillChatSession().dispatch({ workspacePath: '/shop' }, 'missing')).rejects.toThrow(
            'selected migration model is unavailable',
        );
        expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    });

    it('retries initialization after rejection without submitting a prompt', async () => {
        const session = new MigrationSkillChatSession();
        vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce(new Error('initialization failed'));
        await expect(session.dispatch({ workspacePath: '/shop' }, 'auto')).rejects.toThrow('initialization failed');
        expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1);
        await session.dispatch({ workspacePath: '/shop' }, 'auto');
        expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(2, 'workbench.action.chat.newChat');
    });

    it('retains initialization after submission rejection', async () => {
        const session = new MigrationSkillChatSession();
        vi.mocked(vscode.commands.executeCommand)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('submission failed'));
        await expect(session.dispatch({ workspacePath: '/shop' }, 'auto')).rejects.toThrow('submission failed');
        await session.dispatch({ workspacePath: '/shop' }, 'auto');
        expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(3);
        expect(vscode.commands.executeCommand).toHaveBeenLastCalledWith(
            'workbench.action.chat.open',
            expect.anything(),
        );
    });

    it('rejects a duplicate launch while the first dispatch is pending', async () => {
        let finish!: () => void;
        const pending = new Promise<void>((resolve) => {
            finish = resolve;
        });
        vi.mocked(vscode.commands.executeCommand).mockReturnValueOnce(pending);
        const session = new MigrationSkillChatSession();
        const first = session.dispatch({ workspacePath: '/shop' }, 'auto');
        await expect(session.dispatch({ workspacePath: '/shop' }, 'selected')).rejects.toThrow(
            'A migration launch is already pending.',
        );
        await vi.waitFor(() => expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(1));
        finish();
        await first;
        expect(vscode.commands.executeCommand).toHaveBeenCalledTimes(2);
    });

    it('opens Chat without initializing a session, submitting a prompt, or selecting a model', async () => {
        const session = new MigrationSkillChatSession();
        await session.openChat();
        expect(vscode.commands.executeCommand).toHaveBeenCalledExactlyOnceWith('workbench.action.chat.open');
        expect(getAvailableModelsInfo).not.toHaveBeenCalled();
        expect(capturePrompt).not.toHaveBeenCalled();
        await session.dispatch({ workspacePath: '/shop' }, 'auto');
        expect(vscode.commands.executeCommand).toHaveBeenNthCalledWith(2, 'workbench.action.chat.newChat');
    });
});
