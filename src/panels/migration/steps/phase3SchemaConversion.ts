/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { MigrationProjectService, type ProjectJson } from '../../../services/MigrationProjectService';
import { type Channel } from '../../Communication/Channel/Channel';
import { getCosmosDbBestPractices, getIndexPathSyntaxRule } from '../bestPractices';
import {
    type CosmosContainer,
    type CosmosModel,
    type FinalSummaryResult,
    type IndexingPolicy,
    type SchemaConversionStepResult,
} from '../cosmosModel';
import {
    createMkDebug,
    getSelectedModel,
    isDebugPromptsEnabled,
    renderWithDebug,
    runAgenticLoop,
    runAgenticLoopWithJsonResult,
    stripMarkdownPreamble,
    type DebugPromptConfig,
} from '../helpers/aiHelpers';
import { buildBicepParams, buildBicepTemplate } from '../helpers/bicepGenerator';
import {
    saveAnalysisFile,
    saveCosmosModel,
    sendPhaseEvent,
    sendPhaseProgress,
    stripPartitionKeyCandidates,
} from '../helpers/migrationHelpers';
import {
    enrichErrorContext,
    incrementRunCount,
    setAiTelemetryContext,
    setMigrationTelemetryContext,
} from '../helpers/migrationTelemetry';
import { MAX_SCHEMA_TOOL_ROUNDS } from '../migrationConstants';
import {
    Phase3FastConversionPrompt,
    Phase3Step1ContainerDesignPrompt,
    Phase3Step2PartitionKeyPrompt,
    Phase3Step3EmbeddingPrompt,
    Phase3Step4AccessPatternsPrompt,
    Phase3Step5CrossPartitionPrompt,
    Phase3Step6IndexingPrompt,
    Phase3Step7SummaryPrompt,
    Phase3Step8FinalSummaryPrompt,
} from '../prompts';
import { createToolExecutor, getBestPracticeTools } from '../tools/migrationTools';

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Sections to keep from per-domain summaries when building the Step 8
 * (final cross-domain summary) prompt. Full summaries contain example
 * JSON documents and detailed access-pattern tables that consume a lot
 * of tokens but are redundant with the merged model JSON that is already
 * passed separately at higher priority.
 */
const CONDENSED_SECTIONS = new Set([
    'overview',
    'container summary',
    'partition key decisions',
    'embedding strategy',
    'cross-partition queries',
]);

/**
 * Strips a domain summary down to the sections that matter for the
 * cross-domain merge prompt. Keeps Overview, Container Summary (with
 * example JSON code blocks removed), Partition Key Decisions, Embedding
 * Strategy, and Cross-Partition Queries. Everything else (Access Pattern
 * tables, Indexing Policies, Optimization Recommendations, File
 * References) is dropped to save tokens.
 */
function condenseDomainSummary(summary: string): string {
    // Split on level-2 headings (## …)
    const sectionRegex = /^## /m;
    const parts = summary.split(sectionRegex);

    // The text before the first ## heading (if any) is the preamble
    const preamble = parts[0]?.trim() ?? '';

    const kept: string[] = [];
    if (preamble) {
        kept.push(preamble);
    }

    for (let i = 1; i < parts.length; i++) {
        const section = parts[i];
        // Extract heading text (first line)
        const newlineIdx = section.indexOf('\n');
        const heading = (newlineIdx >= 0 ? section.slice(0, newlineIdx) : section).trim();
        const headingLower = heading.replace(/[*#]/g, '').trim().toLowerCase();

        if (CONDENSED_SECTIONS.has(headingLower)) {
            // Remove JSON code blocks (```json … ```) to save tokens
            const cleaned = section.replace(/```json[\s\S]*?```/g, '(example document omitted)');
            kept.push(`## ${cleaned}`);
        }
    }

    return kept.join('\n\n');
}

/**
 * Prepends a persistent warning banner to generated markdown when the agentic
 * tool-call loop hit its round cap. The transient toast is easy to miss, so
 * the banner gives users a durable signal that results may be incomplete.
 */
function prependExhaustionBanner(markdown: string, exhausted: boolean): string {
    if (!exhausted) return markdown;
    const banner = l10n.t(
        '> ⚠️ **Tool-call round limit reached.** Results may be incomplete. Review the output and consider re-running with a narrower scope.',
    );
    return `${banner}\n\n${markdown}`;
}

/**
 * Verbatim disclaimer appended to every Phase 3 summary (per-domain and
 * cross-domain) that contains RU and storage estimates. Kept out of the
 * model's output to save tokens and guarantee consistent wording.
 */
const RU_STORAGE_ESTIMATE_DISCLAIMER =
    '> These RU/s and storage estimates are derived from the volumetrics and workload notes collected during discovery ' +
    '(row counts, average item size, read/write TPS, growth rate, and any optional inputs such as read/write mix, peak ratios, TTL, and P95/P99 item size). ' +
    'They model **projected steady-state operation** and explicitly do **not** size the **initial migration data load**, ' +
    'which has different RU and parallelism requirements that should be planned separately. ' +
    'Actual production values can differ materially due to query selectivity, index policy tuning, hot partitions, document size variance, transient spikes, multi-region / consistency settings, and workload changes. ' +
    'Treat these as a starting point: provision with autoscale, monitor RU consumption and storage growth in Azure Monitor / Cosmos DB Insights, and right-size after observing real traffic.';

/**
 * Appends the RU/storage estimate disclaimer to a summary markdown string.
 * Inserts a top-level `## Estimate Disclaimer` heading so the note is easy
 * to locate regardless of the model's chosen section structure.
 */
function appendEstimateDisclaimer(markdown: string): string {
    const trimmed = markdown.replace(/\s+$/u, '');
    return `${trimmed}\n\n## Estimate Disclaimer\n\n${RU_STORAGE_ESTIMATE_DISCLAIMER}\n`;
}

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
    schemaConversionInstructions: string,
    tools: vscode.LanguageModelChatTool[],
    executeToolCall: (toolCall: vscode.LanguageModelToolCallPart) => Promise<string>,
    token: vscode.CancellationToken,
    debugConfig?: DebugPromptConfig,
    onExhausted?: () => void,
): Promise<CosmosModel> {
    const { value, roundsExhausted } = await runAgenticLoopWithJsonResult<CosmosModel>(
        Phase3Step1ContainerDesignPrompt,
        { domainSummary, bestPractices, sourceType, schemaConversionInstructions },
        model,
        tools,
        executeToolCall,
        MAX_SCHEMA_TOOL_ROUNDS,
        token,
        `Conversion Sub-Step 1 (Container Design: ${domainName})`,
        l10n.t('Could not parse container design response for domain "{name}".', { name: domainName }),
        debugConfig,
    );
    if (roundsExhausted) onExhausted?.();
    return value;
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
    schemaConversionInstructions: string,
    tools: vscode.LanguageModelChatTool[],
    executeToolCall: (toolCall: vscode.LanguageModelToolCallPart) => Promise<string>,
    token: vscode.CancellationToken,
    debugConfig?: DebugPromptConfig,
    onExhausted?: () => void,
    indexPathSyntaxRule?: string,
): Promise<SchemaConversionStepResult> {
    const cosmosModelJson = JSON.stringify(cosmosModel);

    const { value, roundsExhausted } = await runAgenticLoopWithJsonResult<SchemaConversionStepResult>(
        PromptClass,
        {
            domainSummary,
            cosmosModel: cosmosModelJson,
            bestPractices,
            indexPathSyntaxRule: indexPathSyntaxRule ?? '',
            schemaConversionInstructions,
        },
        model,
        tools,
        executeToolCall,
        MAX_SCHEMA_TOOL_ROUNDS,
        token,
        `Conversion Sub-Step (${PromptClass.name})`,
        l10n.t('Could not parse schema conversion sub-step response.'),
        debugConfig,
    );
    if (roundsExhausted) onExhausted?.();
    return value;
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
    outputRelativePath: string,
    schemaConversionInstructions: string,
    volumetricsMd: string | undefined,
    tools: vscode.LanguageModelChatTool[],
    executeToolCall: (toolCall: vscode.LanguageModelToolCallPart) => Promise<string>,
    token: vscode.CancellationToken,
    debugConfig?: DebugPromptConfig,
    onExhausted?: () => void,
): Promise<string> {
    const { messages } = await renderWithDebug(
        Phase3Step7SummaryPrompt,
        {
            domainName,
            cosmosModel: JSON.stringify(cosmosModel),
            partitionKeyAnalysis,
            embeddingAnalysis,
            accessPatternsAnalysis,
            crossPartitionAnalysis,
            indexingAnalysis,
            outputRelativePath,
            schemaConversionInstructions,
            volumetricsMd,
        },
        model,
        token,
        debugConfig,
    );

    const { text, roundsExhausted } = await runAgenticLoop(
        model,
        messages,
        tools,
        executeToolCall,
        MAX_SCHEMA_TOOL_ROUNDS,
        token,
        'Conversion Summary',
        undefined,
        undefined,
        debugConfig,
    );
    if (roundsExhausted) onExhausted?.();
    return text;
}

/**
 * Result shape returned by the fast single-pass conversion prompt.
 */
interface FastConversionResult {
    cosmosModel: CosmosModel;
    summary: string;
}

/**
 * Fast single-pass schema conversion for one domain.
 * Covers container design, partition keys, embedding, access patterns,
 * cross-partition analysis, and indexing in a single LLM call.
 */
async function runFastConversion(
    model: vscode.LanguageModelChat,
    domainName: string,
    domainSummary: string,
    bestPractices: string,
    indexPathSyntaxRule: string,
    sourceType: string,
    outputRelativePath: string,
    schemaConversionInstructions: string,
    volumetricsMd: string | undefined,
    tools: vscode.LanguageModelChatTool[],
    executeToolCall: (toolCall: vscode.LanguageModelToolCallPart) => Promise<string>,
    token: vscode.CancellationToken,
    debugConfig?: DebugPromptConfig,
    onExhausted?: () => void,
): Promise<FastConversionResult> {
    const { value, roundsExhausted } = await runAgenticLoopWithJsonResult<FastConversionResult>(
        Phase3FastConversionPrompt,
        {
            domainSummary,
            bestPractices,
            indexPathSyntaxRule,
            sourceType,
            outputRelativePath,
            schemaConversionInstructions,
            volumetricsMd,
        },
        model,
        tools,
        executeToolCall,
        MAX_SCHEMA_TOOL_ROUNDS,
        token,
        `Fast Schema Conversion (${domainName})`,
        l10n.t('Could not parse fast schema conversion response for domain "{name}".', { name: domainName }),
        debugConfig,
    );
    if (roundsExhausted) onExhausted?.();
    return value;
}

/**
 * Validates that every entity in each container has an attribute whose
 * `target` matches the container's partition key path (without the leading `/`).
 * This is a fundamental Cosmos DB constraint: all documents in a container
 * share the same partition key path, so every document type must carry that field.
 *
 * Returns an array of warning strings. An empty array means the model is valid.
 */
function validatePartitionKeyAlignment(cosmosModel: CosmosModel): string[] {
    const warnings: string[] = [];

    for (const container of cosmosModel.containers) {
        if (!container.partitionKeys || container.partitionKeys.length === 0) {
            continue;
        }

        for (const pk of container.partitionKeys) {
            // Strip leading "/" from path (e.g., "/productId" → "productId")
            const pkField = pk.path.replace(/^\//, '');

            for (const entity of container.entities) {
                // Embedded-only entities do not produce standalone documents,
                // so they are not required to carry the container's partition key.
                if (entity.isEmbeddedOnly) {
                    continue;
                }

                const hasMatchingAttr = entity.attributes.some(
                    (attr) => attr.target === pkField && attr.isPartitionKey === true,
                );

                if (!hasMatchingAttr) {
                    warnings.push(
                        `Container "${container.name}", entity "${entity.name}" (docType: "${entity.docType}"): ` +
                            `missing partition key attribute "${pkField}" (container partition key path: "${pk.path}"). ` +
                            `All document types in a container must include the container's partition key field. ` +
                            `Consider embedding this entity in the primary document type or moving it to a separate container.`,
                    );
                }
            }
        }
    }

    return warnings;
}

/**
 * Programmatically merges per-domain CosmosModels into one unified model.
 * Detects conflicts when containers from different domains share a name.
 */
function mergeDomainModels(domainModels: { domainName: string; model: CosmosModel }[]): {
    merged: CosmosModel;
    conflicts: string[];
} {
    const containerMap = new Map<string, { container: CosmosContainer; domains: string[] }>();
    const conflicts: string[] = [];
    let sourceType: string | undefined;

    const allAccessPatterns = domainModels.flatMap(({ domainName, model }) =>
        (model.accessPatterns ?? []).map((ap) => ({ ...ap, name: `${domainName}: ${ap.name}` })),
    );
    const allCrossPartitionQueries = domainModels.flatMap(({ domainName, model }) =>
        (model.crossPartitionQueries ?? []).map((cpq) => ({ ...cpq, name: `${domainName}: ${cpq.name}` })),
    );

    for (const { domainName, model } of domainModels) {
        if (model.sourceType && !sourceType) {
            sourceType = model.sourceType;
        }

        for (const container of model.containers) {
            const existing = containerMap.get(container.name);
            if (!existing) {
                containerMap.set(container.name, {
                    container: { ...container },
                    domains: [domainName],
                });
            } else {
                existing.domains.push(domainName);

                // Merge entities (append new ones, flag duplicates)
                for (const entity of container.entities) {
                    const duplicate = existing.container.entities.find((e) => e.name === entity.name);
                    if (duplicate) {
                        conflicts.push(
                            `Container "${container.name}": entity "${entity.name}" exists in both ` +
                                `"${existing.domains[0]}" and "${domainName}" domains`,
                        );
                    } else {
                        existing.container.entities.push(entity);
                    }
                }

                // Check partition key conflicts
                const existingPKs = (existing.container.partitionKeys ?? []).map((pk) => pk.path).join(',');
                const newPKs = (container.partitionKeys ?? []).map((pk) => pk.path).join(',');
                if (existingPKs && newPKs && existingPKs !== newPKs) {
                    conflicts.push(
                        `Container "${container.name}": partition key mismatch — ` +
                            `"${existing.domains[0]}" uses [${existingPKs}] vs "${domainName}" uses [${newPKs}]`,
                    );
                }

                // Merge indexing policies
                if (container.indexingPolicy && existing.container.indexingPolicy) {
                    existing.container.indexingPolicy = mergeIndexingPolicies(
                        existing.container.indexingPolicy,
                        container.indexingPolicy,
                    );
                } else if (container.indexingPolicy) {
                    existing.container.indexingPolicy = container.indexingPolicy;
                }
            }
        }
    }

    const merged: CosmosModel = {
        version: 1,
        domain: 'all',
        sourceType,
        containers: Array.from(containerMap.values()).map((v) => v.container),
        accessPatterns: allAccessPatterns.length > 0 ? allAccessPatterns : undefined,
        crossPartitionQueries: allCrossPartitionQueries.length > 0 ? allCrossPartitionQueries : undefined,
    };

    return { merged, conflicts };
}

/**
 * Merges two indexing policies by unioning their paths and composite indexes.
 */
function mergeIndexingPolicies(a: IndexingPolicy, b: IndexingPolicy): IndexingPolicy {
    const unionPaths = (arr1: { path: string }[], arr2: { path: string }[]): { path: string }[] => {
        const set = new Set(arr1.map((p) => p.path));
        const result = [...arr1];
        for (const p of arr2) {
            if (!set.has(p.path)) {
                result.push(p);
                set.add(p.path);
            }
        }
        return result;
    };

    return {
        indexingMode: a.indexingMode ?? b.indexingMode,
        automatic: a.automatic ?? b.automatic,
        includedPaths: unionPaths(a.includedPaths, b.includedPaths),
        excludedPaths: unionPaths(a.excludedPaths, b.excludedPaths),
        compositeIndexes: [...(a.compositeIndexes ?? []), ...(b.compositeIndexes ?? [])],
        fullTextPolicy: a.fullTextPolicy ?? b.fullTextPolicy,
        fullTextIndexes: a.fullTextIndexes ?? b.fullTextIndexes,
    };
}

/**
 * Final step: Run the cross-domain summary + model reconciliation prompt.
 */
async function runFinalSummary(
    model: vscode.LanguageModelChat,
    mergedModel: CosmosModel,
    conflicts: string[],
    domainSummaries: string,
    crossDomainStrategies: string,
    bestPractices: string,
    outputRelativePath: string,
    schemaConversionInstructions: string,
    volumetricsMd: string | undefined,
    tools: vscode.LanguageModelChatTool[],
    executeToolCall: (toolCall: vscode.LanguageModelToolCallPart) => Promise<string>,
    token: vscode.CancellationToken,
    debugConfig?: DebugPromptConfig,
    onExhausted?: () => void,
): Promise<FinalSummaryResult> {
    const { value, roundsExhausted } = await runAgenticLoopWithJsonResult<FinalSummaryResult>(
        Phase3Step8FinalSummaryPrompt,
        {
            mergedModel: JSON.stringify(mergedModel),
            conflicts: conflicts.length > 0 ? conflicts.map((c, i) => `${i + 1}. ${c}`).join('\n') : '',
            domainSummaries,
            crossDomainStrategies,
            bestPractices,
            outputRelativePath,
            schemaConversionInstructions,
            volumetricsMd,
        },
        model,
        tools,
        executeToolCall,
        MAX_SCHEMA_TOOL_ROUNDS,
        token,
        'Final Cross-Domain Summary',
        l10n.t('Could not parse final summary response.'),
        debugConfig,
    );
    if (roundsExhausted) onExhausted?.();
    return value;
}

// ─── Main Entry Point ───────────────────────────────────────────────

export interface Phase3Context {
    project: ProjectJson;
    projectService: MigrationProjectService;
    channel: Channel;
    cancellationToken: vscode.CancellationToken;
}

/**
 * Phase 3: Schema Conversion — transforms RDBMS schema into optimized
 * Cosmos DB NoSQL data models.
 *
 * Supports two modes:
 * - **Fast** (default): Single AI pass per domain covering all 6 analysis
 *   concerns in one prompt. Produces cosmos-model.json + summary.md per domain.
 * - **Thorough** (opt-in): 7 sequential sub-steps per domain with detailed
 *   per-step output files.
 *
 * After all domains complete:
 *   Final Summary → model.json + summary.md (at schema-conversion root)
 */
export async function runSchemaConversion(
    ctx: Phase3Context,
    includeUnmappedDomains?: boolean,
    thoroughAnalysis?: boolean,
): Promise<void> {
    const { project, projectService, channel, cancellationToken: token } = ctx;

    await callWithTelemetryAndErrorHandling('cosmosDB.migration.phase3.schemaConversion', async (context) => {
        setMigrationTelemetryContext(context, project, 'schemaConversion');
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.forceIncludeInReportIssueCommand = true;
        incrementRunCount(project, 'schemaConversion');
        context.telemetry.properties.thoroughAnalysis = String(!!thoroughAnalysis);
        context.telemetry.properties.includeUnmappedDomains = String(!!includeUnmappedDomains);
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
            const rerunItem: vscode.MessageItem = { title: l10n.t('Re-Run Conversion') };
            const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('Schema conversion results already exist. Re-running will overwrite them.'),
                { modal: true },
                rerunItem,
                cancelItem,
            );
            if (overwrite !== rerunItem) return;

            // Delete result files but preserve debug-prompts directories
            try {
                const domainDirs = await vscode.workspace.fs.readDirectory(vscode.Uri.file(domainsPath));
                for (const [name, type] of domainDirs) {
                    if (type === vscode.FileType.Directory) {
                        const domainDir = path.join(domainsPath, name);
                        const entries = await vscode.workspace.fs.readDirectory(
                            MigrationProjectService.toUri(domainDir),
                        );
                        for (const [entryName, entryType] of entries) {
                            if (entryName === 'debug-prompts') continue;
                            await vscode.workspace.fs.delete(MigrationProjectService.toUri(domainDir, entryName), {
                                recursive: entryType === vscode.FileType.Directory,
                            });
                        }
                    } else {
                        await vscode.workspace.fs.delete(MigrationProjectService.toUri(domainsPath, name));
                    }
                }
            } catch {
                // Folder may not exist
            }

            // Also delete root-level outputs (model.json, summary.md)
            for (const rootFile of ['model.json', 'summary.md']) {
                try {
                    await vscode.workspace.fs.delete(MigrationProjectService.toUri(conversionPath, rootFile));
                } catch {
                    // File may not exist
                }
            }
        }

        try {
            const model = await getSelectedModel();
            setAiTelemetryContext(context, model);

            ext.outputChannel.appendLog(
                `[SchemaConversion] Selected model: id="${model.id}", name="${model.name}", maxInputTokens=${model.maxInputTokens}`,
            );
            ext.outputChannel.appendLog(
                `[SchemaConversion] Mode: ${thoroughAnalysis ? 'thorough (7-step)' : 'fast (single-pass)'}`,
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
            const indexPathSyntaxRule = getIndexPathSyntaxRule();
            const sourceType = project.phases.discovery.applicationAnalysis?.databaseType ?? 'Unknown';
            const schemaConversionInstructions = project.phases.schemaConversion?.schemaConversionInstructions ?? '';

            // Load volumetrics.md (optional). When present it grounds RU and
            // storage estimates with real row counts, item sizes, TPS, growth
            // rates, and any optional workload notes the user added.
            let volumetricsMd: string | undefined;
            try {
                const volumetricsMdPath = path.join(projectService.getVolumetricsPath(project), 'volumetrics.md');
                const raw = await vscode.workspace.fs.readFile(vscode.Uri.file(volumetricsMdPath));
                volumetricsMd = Buffer.from(raw).toString('utf-8');
                ext.outputChannel.debug(`[SchemaConversion] Loaded volumetrics.md (${volumetricsMd.length} chars)`);
            } catch {
                ext.outputChannel.debug(
                    `[SchemaConversion] volumetrics.md not found; RU/storage estimates will use defaults`,
                );
            }

            const completedDomains: string[] = [];

            // Set up best practice rule tools for agentic sub-steps
            const tools = getBestPracticeTools();
            const executeToolCall = createToolExecutor({}, '[SchemaConversion]', undefined, undefined, context);

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

                const domainLabel = `domain${di + 1}of${filteredDomainFiles.length}`;
                const progress = (step: string) => `${domainName} (${di + 1}/${filteredDomainFiles.length}): ${step}`;

                const domainDebugDir = path.join(domainOutputPath, 'debug-prompts');
                const mkDebug = createMkDebug(isDebugPromptsEnabled(), domainDebugDir);

                // Track tool-call round exhaustion across all sub-steps for this domain.
                // When any sub-step hits MAX_SCHEMA_TOOL_ROUNDS, we prepend a warning
                // banner to summary.md so the user has a persistent signal (in addition
                // to the transient toast surfaced by the agentic loop helper).
                let domainExhausted = false;
                const markDomainExhausted = () => {
                    domainExhausted = true;
                };

                const domainStartTime = Date.now();
                ext.outputChannel.debug(
                    `[SchemaConversion] Starting domain "${domainName}" (${di + 1}/${filteredDomainFiles.length}), ` +
                        `inputLength=${domainContent.length} chars, mode=${thoroughAnalysis ? 'thorough' : 'fast'}`,
                );

                if (thoroughAnalysis) {
                    // ── Thorough mode: 7 sequential sub-steps ────────────

                    // ── Sub-step 1: Container Design ─────────────────────────
                    context.telemetry.properties.lastStep = `${domainLabel}.containerDesign`;
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
                        schemaConversionInstructions,
                        tools,
                        executeToolCall,
                        token,
                        mkDebug('step1-container-design'),
                        markDomainExhausted,
                    );
                    await saveCosmosModel(domainOutputPath, stripPartitionKeyCandidates(cosmosModel));

                    if (token.isCancellationRequested) return;

                    // ── Sub-step 2: Partition Key Selection ───────────────────
                    context.telemetry.properties.lastStep = `${domainLabel}.partitionKey`;
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
                        schemaConversionInstructions,
                        tools,
                        executeToolCall,
                        token,
                        mkDebug('step2-partition-key'),
                        markDomainExhausted,
                    );
                    await saveAnalysisFile(domainOutputPath, 'partition-key.md', pkResult.analysis);
                    cosmosModel = pkResult.updatedModel;
                    await saveCosmosModel(domainOutputPath, stripPartitionKeyCandidates(cosmosModel));

                    if (token.isCancellationRequested) return;

                    // ── Sub-step 3: Embedding Decisions ──────────────────────
                    context.telemetry.properties.lastStep = `${domainLabel}.embedding`;
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
                        schemaConversionInstructions,
                        tools,
                        executeToolCall,
                        token,
                        mkDebug('step3-embedding'),
                        markDomainExhausted,
                    );
                    await saveAnalysisFile(domainOutputPath, 'embedding-recommendation.md', embedResult.analysis);
                    cosmosModel = embedResult.updatedModel;
                    await saveCosmosModel(domainOutputPath, stripPartitionKeyCandidates(cosmosModel));

                    // Validate partition key alignment across entities
                    // (run after embedding so isEmbeddedOnly flags are set)
                    const pkWarnings = validatePartitionKeyAlignment(cosmosModel);
                    for (const w of pkWarnings) {
                        ext.outputChannel.warn(`[SchemaConversion] ${w}`);
                    }

                    if (token.isCancellationRequested) return;

                    // ── Sub-step 4: Access Patterns ──────────────────────────
                    context.telemetry.properties.lastStep = `${domainLabel}.accessPatterns`;
                    await sendPhaseProgress(
                        channel,
                        'SchemaConversion',
                        'schemaConversionProgress',
                        progress(l10n.t('Access Pattern Mapping…')),
                    );

                    const { text: accessPatternsAnalysis, roundsExhausted: accessExhausted } = await runAgenticLoop(
                        model,
                        (
                            await renderWithDebug(
                                Phase3Step4AccessPatternsPrompt,
                                {
                                    domainSummary: domainContent,
                                    cosmosModel: JSON.stringify(cosmosModel),
                                    bestPractices,
                                    schemaConversionInstructions,
                                },
                                model,
                                token,
                                mkDebug('step4-access-patterns'),
                            )
                        ).messages,
                        tools,
                        executeToolCall,
                        MAX_SCHEMA_TOOL_ROUNDS,
                        token,
                        'Conversion Sub-Step (Access Patterns)',
                        undefined,
                        undefined,
                        mkDebug('step4-access-patterns'),
                    );
                    if (accessExhausted) markDomainExhausted();
                    await saveAnalysisFile(
                        domainOutputPath,
                        'access-patterns.md',
                        stripMarkdownPreamble(accessPatternsAnalysis),
                    );

                    if (token.isCancellationRequested) return;

                    // ── Sub-step 5: Cross-Partition Analysis ─────────────────
                    context.telemetry.properties.lastStep = `${domainLabel}.crossPartition`;
                    await sendPhaseProgress(
                        channel,
                        'SchemaConversion',
                        'schemaConversionProgress',
                        progress(l10n.t('Cross-Partition Analysis…')),
                    );

                    const { text: crossPartitionAnalysis, roundsExhausted: crossExhausted } = await runAgenticLoop(
                        model,
                        (
                            await renderWithDebug(
                                Phase3Step5CrossPartitionPrompt,
                                {
                                    domainSummary: domainContent,
                                    cosmosModel: JSON.stringify(cosmosModel),
                                    bestPractices,
                                    schemaConversionInstructions,
                                },
                                model,
                                token,
                                mkDebug('step5-cross-partition'),
                            )
                        ).messages,
                        tools,
                        executeToolCall,
                        MAX_SCHEMA_TOOL_ROUNDS,
                        token,
                        'Conversion Sub-Step (Cross-Partition Analysis)',
                        undefined,
                        undefined,
                        mkDebug('step5-cross-partition'),
                    );
                    if (crossExhausted) markDomainExhausted();
                    await saveAnalysisFile(
                        domainOutputPath,
                        'domain-cross-partition-analysis.md',
                        stripMarkdownPreamble(crossPartitionAnalysis),
                    );

                    if (token.isCancellationRequested) return;

                    // ── Sub-step 6: Indexing Design ──────────────────────────
                    context.telemetry.properties.lastStep = `${domainLabel}.indexing`;
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
                        schemaConversionInstructions,
                        tools,
                        executeToolCall,
                        token,
                        mkDebug('step6-indexing'),
                        markDomainExhausted,
                        indexPathSyntaxRule,
                    );
                    cosmosModel = idxResult.updatedModel;
                    await saveCosmosModel(domainOutputPath, stripPartitionKeyCandidates(cosmosModel));

                    // Save index-policy.json (per-container indexing policies)
                    const indexPolicies: Record<string, unknown> = {};
                    for (const container of cosmosModel.containers) {
                        if (container.indexingPolicy) {
                            indexPolicies[container.name] = container.indexingPolicy;
                        }
                    }
                    await vscode.workspace.fs.writeFile(
                        MigrationProjectService.toUri(domainOutputPath, 'index-policy.json'),
                        Buffer.from(JSON.stringify(indexPolicies, null, 2), 'utf-8'),
                    );
                    await saveAnalysisFile(domainOutputPath, 'indexing-analysis.md', idxResult.analysis);

                    if (token.isCancellationRequested) return;

                    // ── Sub-step 7: Summary ──────────────────────────────────
                    context.telemetry.properties.lastStep = `${domainLabel}.summary`;
                    await sendPhaseProgress(
                        channel,
                        'SchemaConversion',
                        'schemaConversionProgress',
                        progress(l10n.t('Generating Summary…')),
                    );

                    const summaryRelativePath = path.relative(
                        projectService.getWorkspacePath(),
                        path.join(domainOutputPath, 'summary.md'),
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
                        summaryRelativePath,
                        schemaConversionInstructions,
                        volumetricsMd,
                        tools,
                        executeToolCall,
                        token,
                        mkDebug('step7-summary'),
                        markDomainExhausted,
                    );
                    await saveAnalysisFile(
                        domainOutputPath,
                        'summary.md',
                        prependExhaustionBanner(
                            appendEstimateDisclaimer(stripMarkdownPreamble(summaryContent)),
                            domainExhausted,
                        ),
                    );
                } else {
                    // ── Fast mode: single-pass conversion ────────────────
                    context.telemetry.properties.lastStep = `${domainLabel}.fastConversion`;

                    await sendPhaseProgress(
                        channel,
                        'SchemaConversion',
                        'schemaConversionProgress',
                        progress(l10n.t('Schema Conversion…')),
                    );

                    const summaryRelativePath = path.relative(
                        projectService.getWorkspacePath(),
                        path.join(domainOutputPath, 'summary.md'),
                    );

                    const fastResult = await runFastConversion(
                        model,
                        domainName,
                        domainContent,
                        bestPractices,
                        indexPathSyntaxRule,
                        sourceType,
                        summaryRelativePath,
                        schemaConversionInstructions,
                        volumetricsMd,
                        tools,
                        executeToolCall,
                        token,
                        mkDebug('fast-conversion'),
                        markDomainExhausted,
                    );

                    delete fastResult.cosmosModel.accessPatterns;
                    delete fastResult.cosmosModel.crossPartitionQueries;

                    // Validate partition key alignment across entities
                    const pkWarnings = validatePartitionKeyAlignment(fastResult.cosmosModel);
                    for (const w of pkWarnings) {
                        ext.outputChannel.warn(`[SchemaConversion] ${w}`);
                    }

                    await saveCosmosModel(domainOutputPath, stripPartitionKeyCandidates(fastResult.cosmosModel));
                    await saveAnalysisFile(
                        domainOutputPath,
                        'summary.md',
                        prependExhaustionBanner(
                            appendEstimateDisclaimer(stripMarkdownPreamble(fastResult.summary)),
                            domainExhausted,
                        ),
                    );

                    // Save index-policy.json (per-container indexing policies)
                    const indexPolicies: Record<string, unknown> = {};
                    for (const container of fastResult.cosmosModel.containers) {
                        if (container.indexingPolicy) {
                            indexPolicies[container.name] = container.indexingPolicy;
                        }
                    }
                    await vscode.workspace.fs.writeFile(
                        MigrationProjectService.toUri(domainOutputPath, 'index-policy.json'),
                        Buffer.from(JSON.stringify(indexPolicies, null, 2), 'utf-8'),
                    );
                }

                completedDomains.push(domainName);
                ext.outputChannel.appendLog(
                    `[SchemaConversion] Completed domain "${domainName}" (${di + 1}/${domainFiles.length})`,
                );
                ext.outputChannel.debug(
                    `[SchemaConversion] Domain "${domainName}" finished in ${Date.now() - domainStartTime}ms` +
                        (domainExhausted ? ' (rounds exhausted in one or more sub-steps)' : ''),
                );
            }

            if (token.isCancellationRequested) return;

            // ── Final Step: Cross-Domain Merge & Deployment Model ────
            await sendPhaseProgress(
                channel,
                'SchemaConversion',
                'schemaConversionProgress',
                l10n.t('Generating final deployment model…'),
            );

            // Load all completed domain models
            const domainModels: { domainName: string; model: CosmosModel }[] = [];
            for (const domainName of completedDomains) {
                const modelPath = path.join(domainsPath, domainName, 'cosmos-model.json');
                try {
                    const raw = Buffer.from(await vscode.workspace.fs.readFile(vscode.Uri.file(modelPath))).toString(
                        'utf-8',
                    );
                    domainModels.push({ domainName, model: JSON.parse(raw) as CosmosModel });
                } catch {
                    ext.outputChannel.warn(`[SchemaConversion] Could not load model for domain "${domainName}"`);
                }
            }

            // Programmatic merge
            const { merged, conflicts } = mergeDomainModels(domainModels);
            ext.outputChannel.appendLog(
                `[SchemaConversion] Merged ${domainModels.length} domains → ${merged.containers.length} containers, ${conflicts.length} conflicts`,
            );

            // Collect per-domain summaries (condensed to reduce token usage —
            // the full structural data is already in the merged model JSON)
            const domainSummaryParts: string[] = [];
            for (const domainName of completedDomains) {
                const summaryPath = path.join(domainsPath, domainName, 'summary.md');
                try {
                    const content = Buffer.from(
                        await vscode.workspace.fs.readFile(vscode.Uri.file(summaryPath)),
                    ).toString('utf-8');
                    domainSummaryParts.push(`## Domain: ${domainName}\n\n${condenseDomainSummary(content)}`);
                } catch {
                    domainSummaryParts.push(`## Domain: ${domainName}\n\n(summary not available)`);
                }
            }

            // Collect cross-domain strategies from assessment
            const assessmentDomains = project.phases.assessment?.domains ?? [];
            const crossDomainStrategies = assessmentDomains
                .flatMap((d) => d.crossDomainDependencies)
                .filter((dep, i, arr) => arr.indexOf(dep) === i)
                .join('\n');

            const finalSummaryRelativePath = path.relative(
                projectService.getWorkspacePath(),
                path.join(conversionPath, 'summary.md'),
            );

            const finalDebugDir = path.join(conversionPath, 'debug-prompts');
            const finalMkDebug = createMkDebug(isDebugPromptsEnabled(), finalDebugDir);
            const finalDebugConfig = finalMkDebug('step8-final-summary');

            ext.outputChannel.debug(
                `[SchemaConversion] Generating final summary: ` +
                    `${domainModels.length} domain models, ${merged.containers.length} merged containers, ` +
                    `${conflicts.length} conflicts`,
            );
            const finalSummaryStartTime = Date.now();

            let finalExhausted = false;
            const finalResult = await runFinalSummary(
                model,
                merged,
                conflicts,
                domainSummaryParts.join('\n\n---\n\n'),
                crossDomainStrategies,
                bestPractices,
                finalSummaryRelativePath,
                schemaConversionInstructions,
                volumetricsMd,
                tools,
                executeToolCall,
                token,
                finalDebugConfig,
                () => {
                    finalExhausted = true;
                },
            );

            // Use the LLM-modified model when changes were made, otherwise
            // fall back to the programmatically merged model to avoid
            // wasting output tokens on an unchanged echo.
            if (finalResult.modelModified && !finalResult.updatedModel) {
                throw new Error(l10n.t('Final summary indicated model was modified but returned no model.'));
            }
            const deploymentModel = finalResult.modelModified ? finalResult.updatedModel! : merged;

            // Final validation of partition key alignment on the deployment model
            const finalPkWarnings = validatePartitionKeyAlignment(deploymentModel);
            for (const w of finalPkWarnings) {
                ext.outputChannel.warn(`[SchemaConversion] (final model) ${w}`);
            }

            // Save deployment model and summary at schema-conversion root
            await vscode.workspace.fs.writeFile(
                MigrationProjectService.toUri(conversionPath, 'model.json'),
                Buffer.from(JSON.stringify(stripPartitionKeyCandidates(deploymentModel), null, 2), 'utf-8'),
            );
            await saveAnalysisFile(
                conversionPath,
                'summary.md',
                prependExhaustionBanner(
                    appendEstimateDisclaimer(stripMarkdownPreamble(finalResult.analysis)),
                    finalExhausted,
                ),
            );

            ext.outputChannel.appendLog(
                `[SchemaConversion] Final model saved: ${deploymentModel.containers.length} containers`,
            );
            ext.outputChannel.debug(
                `[SchemaConversion] Final summary generated in ${Date.now() - finalSummaryStartTime}ms, ` +
                    `modelModified=${String(finalResult.modelModified)}`,
            );

            // Generate the Bicep export artifact alongside `model.json`. The two
            // files have different lifecycles:
            //   - `main.bicep` is structural (matches the schema) and is
            //     regenerated on every Phase 3 run unless the user has edited
            //     it after the last Phase 3 completion — in which case we
            //     prompt before overwriting their edits.
            //   - `main.bicepparam` is owned by the user once it exists (Phase
            //     4 refines it with their picks); we only seed defaults here
            //     when no file is present yet.
            try {
                const bicepUri = vscode.Uri.file(projectService.getBicepPath());
                const paramsUri = vscode.Uri.file(projectService.getBicepParamPath());
                const previousCompletedAt = project.phases.schemaConversion?.completedAt;

                let writeBicep = true;
                let bicepStat: vscode.FileStat | undefined;
                try {
                    bicepStat = await vscode.workspace.fs.stat(bicepUri);
                } catch {
                    // File doesn't exist — first generation, write freely.
                }
                if (bicepStat) {
                    const previousMs = previousCompletedAt ? Date.parse(previousCompletedAt) : NaN;
                    const userModified = Number.isNaN(previousMs) || bicepStat.mtime > previousMs;
                    if (userModified) {
                        const replace = l10n.t('Replace');
                        const keep = l10n.t('Keep my version');
                        const choice = await vscode.window.showWarningMessage(
                            l10n.t(
                                'The generated Bicep template "main.bicep" has been modified since the last schema conversion. Replace it with a freshly generated version?',
                            ),
                            { modal: true },
                            replace,
                            keep,
                        );
                        writeBicep = choice === replace;
                    }
                }

                if (writeBicep) {
                    await vscode.workspace.fs.writeFile(
                        bicepUri,
                        Buffer.from(buildBicepTemplate(deploymentModel), 'utf-8'),
                    );
                }

                let paramsExisted = true;
                try {
                    await vscode.workspace.fs.stat(paramsUri);
                } catch {
                    paramsExisted = false;
                }
                if (!paramsExisted) {
                    await vscode.workspace.fs.writeFile(
                        paramsUri,
                        Buffer.from(buildBicepParams({ databaseName: deploymentModel.databaseName }), 'utf-8'),
                    );
                }

                ext.outputChannel.appendLog(
                    `[SchemaConversion] Bicep export ready: ${projectService.getBicepPath()} (bicep ${
                        writeBicep ? 'written' : 'kept'
                    }, params ${paramsExisted ? 'kept' : 'written'})`,
                );
            } catch (bicepError) {
                // Bicep generation is a non-critical export — never fail the
                // schema conversion phase if writing the artifact fails.
                ext.outputChannel.warn(
                    `[SchemaConversion] Failed to write Bicep export: ${
                        bicepError instanceof Error ? bicepError.message : String(bicepError)
                    }`,
                );
            }

            // Update project.json
            project.phases.schemaConversion = {
                status: 'complete',
                domains: completedDomains,
                completedAt: new Date().toISOString(),
            };
            await projectService.save(project);

            // Build rich result with per-domain info for the UI
            const domainResults = domainModels.map(({ domainName, model }) => ({
                name: domainName,
                containers: model.containers.length,
                entities: model.containers.reduce((sum, c) => sum + c.entities.length, 0),
                summaryFilePath: path.join(domainsPath, domainName, 'summary.md'),
                modelFilePath: path.join(domainsPath, domainName, 'cosmos-model.json'),
            }));

            // Structural metrics
            const totalContainers = domainModels.reduce((sum, dm) => sum + dm.model.containers.length, 0);
            context.telemetry.measurements.targetContainerCount = totalContainers;
            context.telemetry.measurements.domainCount = completedDomains.length;
            context.telemetry.measurements.skippedDomainCount = domainFiles.length - filteredDomainFiles.length;

            await sendPhaseEvent(channel, 'schemaConversionCompleted', [
                {
                    domains: domainResults,
                    mergedModelFilePath: path.join(conversionPath, 'model.json'),
                    summaryFilePath: path.join(conversionPath, 'summary.md'),
                },
            ]);
        } catch (error) {
            if (token.isCancellationRequested) throw new vscode.CancellationError();

            enrichErrorContext(context, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            await sendPhaseEvent(channel, 'schemaConversionError', [errorMessage]);
            throw error;
        }
    });
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
