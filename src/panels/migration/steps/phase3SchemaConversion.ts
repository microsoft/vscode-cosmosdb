/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { type MigrationProjectService, type ProjectJson } from '../../../services/MigrationProjectService';
import { type Channel } from '../../Communication/Channel/Channel';
import { getCosmosDbBestPractices } from '../bestPractices';
import { type CosmosModel, type SchemaConversionStepResult } from '../cosmosModel';
import {
    DEBUG_PROMPTS_ENABLED,
    type DebugPromptConfig,
    getSelectedModel,
    runPrompt,
    runPromptWithJsonResult,
} from '../helpers/aiHelpers';
import {
    resetCancellationToken,
    saveAnalysisFile,
    saveCosmosModel,
    sendPhaseEvent,
    sendPhaseProgress,
} from '../helpers/migrationHelpers';
import {
    Phase3Step1ContainerDesignPrompt,
    Phase3Step2PartitionKeyPrompt,
    Phase3Step3EmbeddingPrompt,
    Phase3Step4AccessPatternsPrompt,
    Phase3Step5CrossPartitionPrompt,
    Phase3Step6IndexingPrompt,
    Phase3Step7SummaryPrompt,
} from '../prompts';

// ─── Sub-Step Runners ───────────────────────────────────────────────

/**
 * Sub-step 1: Container Design — returns the initial CosmosModel.
 */
async function runContainerDesign(
    model: vscode.LanguageModelChat,
    domainName: string,
    domainSummary: string,
    bestPractices: string,
    sourceType: string,
    token: vscode.CancellationToken,
    debugConfig?: DebugPromptConfig,
): Promise<CosmosModel> {
    return runPromptWithJsonResult<CosmosModel>(
        Phase3Step1ContainerDesignPrompt,
        { domainSummary, bestPractices, sourceType },
        model,
        token,
        `Conversion Sub-Step 1 (Container Design: ${domainName})`,
        l10n.t('Could not parse container design response for domain "{name}".', { name: domainName }),
        debugConfig,
    );
}

/**
 * Generic sub-step runner for steps 2–6 that return { analysis, updatedModel }.
 */
async function runConversionSubStep(
    PromptClass:
        | typeof Phase3Step2PartitionKeyPrompt
        | typeof Phase3Step3EmbeddingPrompt
        | typeof Phase3Step6IndexingPrompt,
    model: vscode.LanguageModelChat,
    domainSummary: string,
    cosmosModel: CosmosModel,
    bestPractices: string,
    token: vscode.CancellationToken,
    debugConfig?: DebugPromptConfig,
): Promise<SchemaConversionStepResult> {
    const cosmosModelJson = JSON.stringify(cosmosModel, null, 2);

    return runPromptWithJsonResult<SchemaConversionStepResult>(
        PromptClass,
        { domainSummary, cosmosModel: cosmosModelJson, bestPractices },
        model,
        token,
        `Conversion Sub-Step (${PromptClass.name})`,
        l10n.t('Could not parse schema conversion sub-step response.'),
        debugConfig,
    );
}

/**
 * Sub-step 7: Summary — returns markdown text.
 */
async function runConversionSummary(
    model: vscode.LanguageModelChat,
    domainName: string,
    cosmosModel: CosmosModel,
    partitionKeyAnalysis: string,
    embeddingAnalysis: string,
    accessPatternsAnalysis: string,
    crossPartitionAnalysis: string,
    indexingAnalysis: string,
    token: vscode.CancellationToken,
    debugConfig?: DebugPromptConfig,
): Promise<string> {
    return runPrompt(
        Phase3Step7SummaryPrompt,
        {
            domainName,
            cosmosModel: JSON.stringify(cosmosModel, null, 2),
            partitionKeyAnalysis,
            embeddingAnalysis,
            accessPatternsAnalysis,
            crossPartitionAnalysis,
            indexingAnalysis,
        },
        model,
        token,
        'Conversion Summary',
        undefined,
        debugConfig,
    );
}

// ─── Main Entry Point ───────────────────────────────────────────────

export interface Phase3Context {
    project: ProjectJson;
    projectService: MigrationProjectService;
    channel: Channel;
    schemaConversionCancellation: vscode.CancellationTokenSource | undefined;
}

export interface Phase3Result {
    schemaConversionCancellation: vscode.CancellationTokenSource | undefined;
}

/**
 * Phase 3: Schema Conversion — transforms RDBMS schema into optimized
 * Cosmos DB NoSQL data models. Executes 7 sub-steps sequentially
 * per domain from the Step 2 assessment output.
 *
 * Sub-steps per domain:
 *   1. Container Design       → cosmos-model.json
 *   2. Partition Key Selection → partition-key.md + updated cosmos-model.json
 *   3. Embedding Decisions     → embedding-recommendation.md + updated cosmos-model.json
 *   4. Access Patterns         → access-patterns.md
 *   5. Cross-Partition Analysis → domain-cross-partition-analysis.md
 *   6. Indexing Design         → index-policy.json + updated cosmos-model.json
 *   7. Summary                 → summary.md
 */
export async function runSchemaConversion(ctx: Phase3Context, includeUnmappedDomains?: boolean): Promise<Phase3Result> {
    let { schemaConversionCancellation } = ctx;
    const { project, projectService, channel } = ctx;

    await callWithTelemetryAndErrorHandling('migration.ai.schemaConversion', async () => {
        // Check if schema conversion results already exist
        const conversionPath = projectService.getSchemaConversionPath();
        const domainsPath = path.join(conversionPath, 'domains');
        let hasExisting = false;
        try {
            const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(domainsPath));
            hasExisting = entries.some(([, type]) => type === vscode.FileType.Directory);
        } catch {
            // Folder doesn't exist
        }

        if (hasExisting) {
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('Schema conversion results already exist. Re-running will overwrite them.'),
                { modal: true },
                l10n.t('Re-Run Conversion'),
            );
            if (overwrite !== l10n.t('Re-Run Conversion')) return;

            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(domainsPath), { recursive: true });
            } catch {
                // Folder may not exist
            }
        }

        schemaConversionCancellation = resetCancellationToken(schemaConversionCancellation);
        const token = schemaConversionCancellation.token;

        try {
            const model = await getSelectedModel();

            ext.outputChannel.appendLog(
                `[SchemaConversion] Selected model: id="${model.id}", name="${model.name}", maxInputTokens=${model.maxInputTokens}`,
            );

            // Read assessment domains
            const assessmentPath = projectService.getAssessmentPath();
            const assessmentDomainsPath = path.join(assessmentPath, 'domains');
            const domainFiles = await projectService.listFiles(assessmentDomainsPath);

            if (domainFiles.length === 0) {
                throw new Error(l10n.t('No assessment domains found. Please complete Step 2 first.'));
            }

            // Filter domains based on whether they have code-detected access patterns
            let filteredDomainFiles = domainFiles;
            if (!includeUnmappedDomains) {
                const assessmentDomains = project.phases.assessment?.domains;
                const mappedDomainNames = new Set(
                    (assessmentDomains ?? []).filter((d) => d.isMapped === true).map((d) => d.name),
                );

                if (mappedDomainNames.size > 0) {
                    filteredDomainFiles = domainFiles.filter((fp) => {
                        const fileName = path.basename(fp, '.md');
                        return mappedDomainNames.has(fileName);
                    });
                }

                if (filteredDomainFiles.length === 0) {
                    throw new Error(
                        l10n.t(
                            'No domains with detected access patterns found. Enable "Include domains without detected application code access patterns" to convert all domains.',
                        ),
                    );
                }

                ext.outputChannel.appendLog(
                    `[SchemaConversion] Filtered to ${filteredDomainFiles.length}/${domainFiles.length} domains with access patterns`,
                );
            }

            await sendPhaseEvent(channel, 'schemaConversionStarted');

            const bestPractices = getCosmosDbBestPractices();
            const sourceType = project.phases.discovery.applicationAnalysis?.databaseType ?? 'Unknown';
            const completedDomains: string[] = [];

            for (let di = 0; di < filteredDomainFiles.length; di++) {
                if (token.isCancellationRequested) return;

                const domainFilePath = filteredDomainFiles[di];
                const domainFileName = path.basename(domainFilePath, '.md');
                const domainContent = Buffer.from(
                    await vscode.workspace.fs.readFile(vscode.Uri.file(domainFilePath)),
                ).toString('utf-8');

                const domainNameMatch = domainContent.match(/^# Domain:\s*(.+)$/m);
                const domainName = domainNameMatch?.[1]?.trim() ?? domainFileName;

                const domainOutputPath = path.join(domainsPath, domainFileName);
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(domainOutputPath));

                const progress = (step: string) => `${domainName} (${di + 1}/${filteredDomainFiles.length}): ${step}`;

                const domainDebugDir = path.join(domainOutputPath, 'debug-prompts');
                const mkDebug = (stepName: string): DebugPromptConfig | undefined =>
                    DEBUG_PROMPTS_ENABLED ? { debugDir: domainDebugDir, stepName } : undefined;

                // ── Sub-step 1: Container Design ─────────────────────────
                await sendPhaseProgress(
                    channel,
                    'SchemaConversion',
                    'schemaConversionProgress',
                    progress(l10n.t('Container Design…')),
                );

                let cosmosModel = await runContainerDesign(
                    model,
                    domainName,
                    domainContent,
                    bestPractices,
                    sourceType,
                    token,
                    mkDebug('step1-container-design'),
                );
                await saveCosmosModel(domainOutputPath, cosmosModel);

                if (token.isCancellationRequested) return;

                // ── Sub-step 2: Partition Key Selection ───────────────────
                await sendPhaseProgress(
                    channel,
                    'SchemaConversion',
                    'schemaConversionProgress',
                    progress(l10n.t('Partition Key Selection…')),
                );

                const pkResult = await runConversionSubStep(
                    Phase3Step2PartitionKeyPrompt,
                    model,
                    domainContent,
                    cosmosModel,
                    bestPractices,
                    token,
                    mkDebug('step2-partition-key'),
                );
                await saveAnalysisFile(domainOutputPath, 'partition-key.md', pkResult.analysis);
                cosmosModel = pkResult.updatedModel;
                await saveCosmosModel(domainOutputPath, cosmosModel);

                if (token.isCancellationRequested) return;

                // ── Sub-step 3: Embedding Decisions ──────────────────────
                await sendPhaseProgress(
                    channel,
                    'SchemaConversion',
                    'schemaConversionProgress',
                    progress(l10n.t('Embedding Decisions…')),
                );

                const embedResult = await runConversionSubStep(
                    Phase3Step3EmbeddingPrompt,
                    model,
                    domainContent,
                    cosmosModel,
                    bestPractices,
                    token,
                    mkDebug('step3-embedding'),
                );
                await saveAnalysisFile(domainOutputPath, 'embedding-recommendation.md', embedResult.analysis);
                cosmosModel = embedResult.updatedModel;
                await saveCosmosModel(domainOutputPath, cosmosModel);

                if (token.isCancellationRequested) return;

                // ── Sub-step 4: Access Patterns ──────────────────────────
                await sendPhaseProgress(
                    channel,
                    'SchemaConversion',
                    'schemaConversionProgress',
                    progress(l10n.t('Access Pattern Mapping…')),
                );

                const accessPatternsAnalysis = await runPrompt(
                    Phase3Step4AccessPatternsPrompt,
                    { domainSummary: domainContent, cosmosModel: JSON.stringify(cosmosModel, null, 2), bestPractices },
                    model,
                    token,
                    'Conversion Sub-Step (Access Patterns)',
                    undefined,
                    mkDebug('step4-access-patterns'),
                );
                await saveAnalysisFile(domainOutputPath, 'access-patterns.md', accessPatternsAnalysis);

                if (token.isCancellationRequested) return;

                // ── Sub-step 5: Cross-Partition Analysis ─────────────────
                await sendPhaseProgress(
                    channel,
                    'SchemaConversion',
                    'schemaConversionProgress',
                    progress(l10n.t('Cross-Partition Analysis…')),
                );

                const crossPartitionAnalysis = await runPrompt(
                    Phase3Step5CrossPartitionPrompt,
                    { domainSummary: domainContent, cosmosModel: JSON.stringify(cosmosModel, null, 2), bestPractices },
                    model,
                    token,
                    'Conversion Sub-Step (Cross-Partition Analysis)',
                    undefined,
                    mkDebug('step5-cross-partition'),
                );
                await saveAnalysisFile(domainOutputPath, 'domain-cross-partition-analysis.md', crossPartitionAnalysis);

                if (token.isCancellationRequested) return;

                // ── Sub-step 6: Indexing Design ──────────────────────────
                await sendPhaseProgress(
                    channel,
                    'SchemaConversion',
                    'schemaConversionProgress',
                    progress(l10n.t('Indexing Design…')),
                );

                const idxResult = await runConversionSubStep(
                    Phase3Step6IndexingPrompt,
                    model,
                    domainContent,
                    cosmosModel,
                    bestPractices,
                    token,
                    mkDebug('step6-indexing'),
                );
                cosmosModel = idxResult.updatedModel;
                await saveCosmosModel(domainOutputPath, cosmosModel);

                // Save index-policy.json (per-container indexing policies)
                const indexPolicies: Record<string, unknown> = {};
                for (const container of cosmosModel.containers) {
                    if (container.indexingPolicy) {
                        indexPolicies[container.name] = container.indexingPolicy;
                    }
                }
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(path.join(domainOutputPath, 'index-policy.json')),
                    Buffer.from(JSON.stringify(indexPolicies, null, 2), 'utf-8'),
                );
                await saveAnalysisFile(domainOutputPath, 'indexing-analysis.md', idxResult.analysis);

                if (token.isCancellationRequested) return;

                // ── Sub-step 7: Summary ──────────────────────────────────
                await sendPhaseProgress(
                    channel,
                    'SchemaConversion',
                    'schemaConversionProgress',
                    progress(l10n.t('Generating Summary…')),
                );

                const summaryContent = await runConversionSummary(
                    model,
                    domainName,
                    cosmosModel,
                    pkResult.analysis,
                    embedResult.analysis,
                    accessPatternsAnalysis,
                    crossPartitionAnalysis,
                    idxResult.analysis,
                    token,
                    mkDebug('step7-summary'),
                );
                await saveAnalysisFile(domainOutputPath, 'summary.md', summaryContent);

                completedDomains.push(domainName);
                ext.outputChannel.appendLog(
                    `[SchemaConversion] Completed domain "${domainName}" (${di + 1}/${domainFiles.length})`,
                );
            }

            // Update project.json
            project.phases.schemaConversion = {
                status: 'complete',
                domains: completedDomains,
                completedAt: new Date().toISOString(),
            };
            await projectService.save(project);

            await sendPhaseEvent(channel, 'schemaConversionCompleted', [{ domains: completedDomains }]);
        } catch (error) {
            if (schemaConversionCancellation?.token.isCancellationRequested) return;

            const errorMessage = error instanceof Error ? error.message : String(error);
            await sendPhaseEvent(channel, 'schemaConversionError', [errorMessage]);
        }
    });

    return { schemaConversionCancellation };
}

/**
 * Cancels an in-progress schema conversion operation.
 */
export async function cancelSchemaConversion(
    schemaConversionCancellation: vscode.CancellationTokenSource | undefined,
    channel: Channel,
): Promise<vscode.CancellationTokenSource | undefined> {
    schemaConversionCancellation?.cancel();
    schemaConversionCancellation?.dispose();
    await sendPhaseEvent(channel, 'schemaConversionCancelled');
    return undefined;
}
