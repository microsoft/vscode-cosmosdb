/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { MIGRATION_FOLDER, MigrationProjectService } from '../../../services/MigrationProjectService';
import { getAvailableModelsInfo } from '../../../utils/aiUtils';
import { getMigrationModels, MIGRATION_SELECTED_MODEL_KEY, resolveSelectedModelId } from '../../../utils/modelUtils';
import { capturePrompt, isMigrationAiMockEnabled } from './e2eMigrationAiMock';

export type MigrationSkillExecutionMode = 'interactive' | 'autonomous';
export type MigrationSkillPhase =
    | 'preflight'
    | 'discovery'
    | 'assessment'
    | 'schema-conversion'
    | 'provisioning'
    | 'code-migration';
export type MigrationPreflightStep = 'schema-acquisition' | 'application-details' | 'volumetrics' | 'access-patterns';
export type MigrationProvisioningStep = 'target-account' | 'resources-and-data';
export type MigrationCodeMigrationAction = 'plan' | 'migrate';

export interface MigrationSkillInvocation {
    workspacePath: string;
    runId?: string;
    mode?: MigrationSkillExecutionMode;
    phase?: MigrationSkillPhase;
    preflightStep?: MigrationPreflightStep;
    provisioningStep?: MigrationProvisioningStep;
    includeUnmappedDomains?: boolean;
    allowProvisioning?: boolean;
    codeMigrationAction?: MigrationCodeMigrationAction;
}

export function shouldUseMigrationSkill(): boolean {
    return !(
        vscode.workspace
            .getConfiguration('cosmosDB')
            .get<boolean>('experimental.migration.useProgrammaticFlow', false) ?? false
    );
}

async function hasMigrationSkillArtifacts(invocation: MigrationSkillInvocation): Promise<boolean> {
    if (invocation.phase === undefined) return false;

    const service = new MigrationProjectService(invocation.workspacePath);
    const discoveryPath = service.getDiscoveryPath();
    const provisioningPath = service.getProvisioningPath();
    const migrationPath = path.join(invocation.workspacePath, MIGRATION_FOLDER);
    let artifactPaths: string[];
    if (invocation.phase === 'preflight' && invocation.preflightStep !== undefined) {
        switch (invocation.preflightStep) {
            case 'application-details': {
                const project = await service.load({ readOnly: true });
                return Boolean(project?.phases.discovery.applicationAnalysis?.completedAt);
            }
            case 'schema-acquisition':
                return false;
            case 'volumetrics':
                artifactPaths = [path.join(discoveryPath, 'volumetrics', 'volumetrics.md')];
                break;
            case 'access-patterns':
                artifactPaths = [path.join(discoveryPath, 'access-patterns', 'access-patterns.md')];
                break;
        }
    } else if (invocation.phase === 'provisioning' && invocation.provisioningStep !== undefined) {
        if (invocation.provisioningStep === 'target-account') return false;
        artifactPaths = ['sample-data.json', 'seed-data.csh'].map((file) => path.join(provisioningPath, file));
    } else {
        const phaseArtifacts: Record<MigrationSkillPhase, string[]> = {
            preflight: ['preflight-summary.md', 'preflight-manifest.json'].map((file) =>
                path.join(discoveryPath, file),
            ),
            discovery: ['discovery-report.md', 'discovery-manifest.json'].map((file) => path.join(discoveryPath, file)),
            assessment: ['assessment-summary.md', 'assessment-manifest.json'].map((file) =>
                path.join(service.getAssessmentPath(), file),
            ),
            'schema-conversion': ['model.json', 'summary.md', 'manifest.json'].map((file) =>
                path.join(service.getSchemaConversionPath(), file),
            ),
            provisioning: [
                'main.bicep',
                'main.bicepparam',
                'sample-data.json',
                'seed-data.csh',
                'summary.md',
                'manifest.json',
            ].map((file) => path.join(provisioningPath, file)),
            'code-migration': [path.join(migrationPath, 'code-migration-plan.md')],
        };
        artifactPaths = phaseArtifacts[invocation.phase];
    }

    for (const artifactPath of artifactPaths) {
        try {
            const stat = await vscode.workspace.fs.stat(MigrationProjectService.toUri(artifactPath));
            if (stat.type & vscode.FileType.File) return true;
        } catch {
            continue;
        }
    }
    return false;
}

export function buildMigrationSkillPrompt(invocation: MigrationSkillInvocation, hasExistingArtifacts = false): string {
    if (invocation.provisioningStep !== undefined && invocation.phase !== 'provisioning') {
        throw new Error('provisioningStep requires phase provisioning');
    }
    if (invocation.provisioningStep !== undefined && invocation.allowProvisioning !== true) {
        throw new Error('Focused provisioning mutations require explicit authorization');
    }
    if (invocation.codeMigrationAction !== undefined && invocation.phase !== 'code-migration') {
        throw new Error('codeMigrationAction requires phase code-migration');
    }
    const codeMigrationAction =
        invocation.phase === 'code-migration' ? (invocation.codeMigrationAction ?? 'plan') : undefined;
    const phaseLabel = invocation.phase?.replaceAll('-', ' ');
    const lines = [
        invocation.phase === undefined
            ? 'Run a relational database migration to Azure Cosmos DB.'
            : hasExistingArtifacts && codeMigrationAction === undefined
              ? `Regenerate the ${phaseLabel} results for a relational database migration to Azure Cosmos DB.`
              : `Run the ${phaseLabel} phase of a relational database migration to Azure Cosmos DB.`,
        'Use the cosmosdb-relational-migration skill.',
        ...(invocation.mode === 'autonomous' ? ['Run in autonomous mode.'] : []),
        ...(invocation.preflightStep === undefined ? [] : [`Run only the ${invocation.preflightStep} preflight step.`]),
        ...(invocation.includeUnmappedDomains === undefined
            ? []
            : [invocation.includeUnmappedDomains ? 'Include unmapped domains.' : 'Do not include unmapped domains.']),
        ...(invocation.provisioningStep === undefined
            ? []
            : [`Run only the ${invocation.provisioningStep} provisioning step.`]),
        ...(codeMigrationAction === undefined
            ? []
            : codeMigrationAction === 'plan'
              ? [
                    hasExistingArtifacts
                        ? 'Update the application code migration plan.'
                        : 'Create the application code migration plan.',
                ]
              : ['Migrate the application code using the validated migration plan.']),
        ...(invocation.allowProvisioning === true ? ['Allow provisioning for this invocation.'] : []),
        ...(invocation.runId === undefined ? [] : [`Run ID: ${invocation.runId}`]),
    ];

    return lines.join('\n');
}

export class MigrationSkillChatSession {
    private initialization: Promise<void> | undefined;
    private dispatching = false;

    private initialize(): Promise<void> {
        this.initialization ??= (async () => {
            if (!isMigrationAiMockEnabled()) {
                const commands = await vscode.commands.getCommands(true);
                const newChatCommand = commands.includes('workbench.action.chat.newLocalChat')
                    ? 'workbench.action.chat.newLocalChat'
                    : 'workbench.action.chat.newChat';
                await vscode.commands.executeCommand(newChatCommand);
            }
        })().catch((error: unknown) => {
            this.initialization = undefined;
            throw error;
        });
        return this.initialization;
    }

    public async dispatch(invocation: MigrationSkillInvocation, selectedModelId: string | null): Promise<string> {
        if (this.dispatching) {
            throw new Error(l10n.t('A migration launch is already pending.'));
        }
        this.dispatching = true;
        try {
            return await this.submit(invocation, selectedModelId);
        } finally {
            this.dispatching = false;
        }
    }

    public async openChat(): Promise<void> {
        if (!isMigrationAiMockEnabled()) {
            await vscode.commands.executeCommand('workbench.action.chat.open');
        }
    }

    private async submit(invocation: MigrationSkillInvocation, selectedModelId: string | null): Promise<string> {
        const query = buildMigrationSkillPrompt(invocation, await hasMigrationSkillArtifacts(invocation));
        const { models, savedModelId } = await getAvailableModelsInfo(MIGRATION_SELECTED_MODEL_KEY, {
            includeAuto: true,
        });
        const modelId = selectedModelId ?? resolveSelectedModelId(getMigrationModels(models, false), savedModelId);
        const model = models.find((candidate) => candidate.id === modelId);
        if (!model) {
            throw new Error(l10n.t('The selected migration model is unavailable. Please select an available model.'));
        }
        const modelSelector = { vendor: model.vendor, id: model.id };
        const newSession = this.initialization === undefined;
        await this.initialize();
        if (isMigrationAiMockEnabled()) {
            capturePrompt(`skill-${invocation.phase ?? 'all'}`, query, { newSession, modelSelector });
        } else {
            await vscode.commands.executeCommand('workbench.action.chat.open', { mode: 'agent', query, modelSelector });
        }
        return query;
    }
}
