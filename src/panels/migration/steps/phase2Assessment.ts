/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { renderPrompt } from '@vscode/prompt-tsx';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { type MigrationProjectService, type ProjectJson } from '../../../services/MigrationProjectService';
import { extractStructuralDDL } from '../../../utils/ddlExtractor';
import { type Channel } from '../../Communication/Channel/Channel';
import { getCosmosDbBestPractices } from '../bestPractices';
import {
    buildDependencyGraph,
    extractSchemaGroups,
    formatSchemaGroups,
    getSubgraphForTables,
    serializeGraphForPrompt,
} from '../dependencyGraph';
import {
    DEBUG_PROMPTS_ENABLED,
    getSelectedModel,
    logTokenUsage,
    runAgenticLoop,
    runPrompt,
    runPromptWithJsonResult,
} from '../helpers/aiHelpers';
import { dumpDebugPrompt, sanitizeStepName, tryLoadOverrideMessages } from '../helpers/debugPromptHelpers';
import {
    assignAccessPatternsToDomains,
    formatDomainMarkdown,
    type ParsedAccessPattern,
    resetCancellationToken,
    sendPhaseEvent,
    sendPhaseProgress,
} from '../helpers/migrationHelpers';
import {
    Phase2Step0AccessPatternExtractionPrompt,
    Phase2Step1AssessmentPrompt,
    Phase2Step2SplitDomainPrompt,
    Phase2Step3CrossDomainPrompt,
    Phase2Step4DomainMappingPrompt,
    Phase2Step5SummaryPrompt,
} from '../prompts';
import { createToolExecutor, WORKSPACE_TOOLS } from '../tools/migrationTools';

// ─── Types ───────────────────────────────────────────────────────────

interface DomainIdentificationResult {
    domains: {
        name: string;
        description: string;
        tables: string[];
        rationale: string;
        aggregateRoot: string;
    }[];
}

type DomainWithTokens = DomainIdentificationResult['domains'][number] & {
    estimatedTokens: number;
    accessPatterns: ParsedAccessPattern[];
};

interface CrossDomainResult {
    crossDomainDependencies: { relationship: string; strategy: string }[];
    domainRecommendations: Record<string, string[]>;
    summary: string;
}

// ─── Domain Mapping Detection ───────────────────────────────────────

/**
 * Runs an AI prompt with tool access for each domain to determine whether the
 * domain's tables are referenced in the application source code (isMapped).
 */
async function detectDomainMappings(
    model: vscode.LanguageModelChat,
    domains: { name: string; tables: string[]; accessPatterns?: { name: string; codeReferences?: string[] }[] }[],
    language: string,
    frameworks: string[],
    channel: Channel,
    token: vscode.CancellationToken,
    assessmentDebugDir: string,
): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const tools = WORKSPACE_TOOLS;
    const executeToolCall = createToolExecutor({}, '[Assessment]', { language, frameworks });

    const MAX_TOOL_ROUNDS = 15;

    for (const domain of domains) {
        if (token.isCancellationRequested) return results;

        // If the domain already has known code references from the discovery report,
        // trust them and skip the expensive AI tool-based verification.
        const hasKnownCodeRefs = (domain.accessPatterns ?? []).some(
            (ap) => ap.codeReferences && ap.codeReferences.length > 0,
        );
        if (hasKnownCodeRefs) {
            results.set(domain.name, true);
            ext.outputChannel.appendLog(
                `[Assessment] Phase 6: "${domain.name}" isMapped=true — known code references from discovery report`,
            );
            continue;
        }

        await sendPhaseProgress(
            channel,
            'Assessment',
            'assessmentProgress',
            l10n.t('Phase 6/6: Checking mapping for "{domain}"…', { domain: domain.name }),
        );

        ext.outputChannel.appendLog(
            `[Assessment] Phase 6: Checking mapping for domain "${domain.name}" (tables: ${domain.tables.join(', ')})`,
        );

        try {
            // Build summary of known code references from the assessment
            const knownRefs = (domain.accessPatterns ?? [])
                .filter((ap) => ap.codeReferences && ap.codeReferences.length > 0)
                .map((ap) => `- ${ap.name}: ${ap.codeReferences!.join(', ')}`)
                .join('\n');

            const mappingProps = {
                domainName: domain.name,
                tables: domain.tables,
                language,
                frameworks,
                domainSummary: knownRefs,
            };

            const mappingStepName = sanitizeStepName(`step4-domain-mapping-${domain.name}`);
            let mappingMessages: vscode.LanguageModelChatMessage[];

            if (DEBUG_PROMPTS_ENABLED) {
                const override = await tryLoadOverrideMessages(
                    assessmentDebugDir,
                    mappingStepName,
                    Phase2Step4DomainMappingPrompt,
                    model,
                    token,
                );
                if (override) {
                    mappingMessages = override;
                } else {
                    ({ messages: mappingMessages } = await renderPrompt(
                        Phase2Step4DomainMappingPrompt,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        mappingProps as any,
                        { modelMaxPromptTokens: model.maxInputTokens },
                        model,
                        undefined,
                        token,
                    ));
                    await dumpDebugPrompt(assessmentDebugDir, mappingStepName, mappingMessages, mappingProps);
                }
            } else {
                ({ messages: mappingMessages } = await renderPrompt(
                    Phase2Step4DomainMappingPrompt,
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    mappingProps as any,
                    { modelMaxPromptTokens: model.maxInputTokens },
                    model,
                    undefined,
                    token,
                ));
            }

            let allResponseText = '';
            const fullText = await runAgenticLoop(
                model,
                mappingMessages,
                tools,
                async (toolCall) => {
                    const input = toolCall.input as Record<string, string>;
                    const inputArg = input.filePath ?? input.pattern ?? '';
                    ext.outputChannel.appendLog(
                        `[Assessment] Phase 5 "${domain.name}": Tool call ${toolCall.name}(${inputArg})`,
                    );
                    return executeToolCall(toolCall);
                },
                MAX_TOOL_ROUNDS,
                token,
                async (round, textChunk, isLastRound) => {
                    allResponseText += textChunk;
                    if (isLastRound) {
                        await logTokenUsage(
                            model,
                            `Assessment Phase 6 (Mapping "${domain.name}")`,
                            mappingMessages,
                            allResponseText,
                        );
                    } else {
                        ext.outputChannel.appendLog(
                            `[Assessment] Phase 6 "${domain.name}": AI text (round ${round + 1}): ${textChunk.trim()}`,
                        );
                    }
                },
            );

            const jsonMatch = fullText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as { isMapped: boolean; evidence?: string };
                results.set(domain.name, parsed.isMapped === true);
                ext.outputChannel.appendLog(
                    `[Assessment] Phase 6: "${domain.name}" isMapped=${String(parsed.isMapped)} — ${parsed.evidence ?? ''}`,
                );
            } else {
                results.set(domain.name, false);
                ext.outputChannel.appendLog(
                    `[Assessment] Phase 6: "${domain.name}" — could not parse mapping result, defaulting to false`,
                );
            }
        } catch (e) {
            results.set(domain.name, false);
            ext.outputChannel.appendLog(
                `[Assessment] Phase 6: "${domain.name}" — error detecting mapping: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }

    const mappedCount = Array.from(results.values()).filter(Boolean).length;
    ext.outputChannel.appendLog(
        `[Assessment] Phase 6 complete: ${mappedCount}/${domains.length} domains mapped in code`,
    );

    return results;
}

// ─── Main Entry Point ───────────────────────────────────────────────

export interface Phase2Context {
    project: ProjectJson;
    projectService: MigrationProjectService;
    channel: Channel;
    assessmentCancellation: vscode.CancellationTokenSource | undefined;
}

export interface Phase2Result {
    assessmentCancellation: vscode.CancellationTokenSource | undefined;
}

/**
 * Phase 2: Domain decomposition assessment in 6 phases.
 *   Phase 1 — Access Pattern Extraction (AI extraction from discovery report)
 *   Phase 2 — Domain Identification (AI + DDD patterns)
 *   Phase 3 — Token Estimation (programmatic via model.countTokens)
 *   Phase 4 — Domain Splitting (conditional AI for domains > 150K tokens)
 *   Phase 5 — Cross-Domain Analysis (AI for FK handling + recommendations)
 *   Phase 6 — Domain Mapping Detection (AI + tools to check source code)
 */
export async function runAssessment(ctx: Phase2Context): Promise<Phase2Result> {
    let { assessmentCancellation } = ctx;
    const { project, projectService, channel } = ctx;

    await callWithTelemetryAndErrorHandling('migration.ai.assessment', async () => {
        // Check if assessment results already exist and ask for confirmation
        const assessmentPath = projectService.getAssessmentPath();
        const domainsPath = path.join(assessmentPath, 'domains');
        const summaryPath = path.join(assessmentPath, 'assessment-summary.md');
        let hasExisting = false;
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(summaryPath));
            hasExisting = true;
        } catch {
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(domainsPath));
                hasExisting = true;
            } catch {
                // Neither exists
            }
        }

        if (hasExisting) {
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('Assessment results already exist. Re-running will overwrite them.'),
                { modal: true },
                l10n.t('Re-Run Assessment'),
            );
            if (overwrite !== l10n.t('Re-Run Assessment')) return;

            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(domainsPath), { recursive: true });
            } catch {
                // Folder may not exist
            }
            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(summaryPath));
            } catch {
                // File may not exist
            }
        }

        assessmentCancellation = resetCancellationToken(assessmentCancellation);
        const token = assessmentCancellation.token;

        try {
            const model = await getSelectedModel();

            ext.outputChannel.appendLog(
                `[Assessment] Selected model: id="${model.id}", name="${model.name}", maxInputTokens=${model.maxInputTokens}`,
            );

            await sendPhaseEvent(channel, 'assessmentStarted');

            if (token.isCancellationRequested) return;

            // 1. Read the discovery report
            const discoveryReportPath = path.join(projectService.getDiscoveryPath(), 'discovery-report.md');
            let discoveryReport = '';
            try {
                const content = await vscode.workspace.fs.readFile(vscode.Uri.file(discoveryReportPath));
                discoveryReport = Buffer.from(content).toString('utf-8');
            } catch {
                throw new Error(l10n.t('Discovery report not found. Please complete Step 1 first.'));
            }

            // 2. Build dependency graph from schema DDL files
            const schemaPath = projectService.getSchemaPath(project);
            const schemaFiles = await projectService.listFiles(schemaPath);
            let allDDL = '';
            for (const file of schemaFiles) {
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
                    const rawText = Buffer.from(content).toString('utf-8');
                    const fileExt = path.extname(file).toLowerCase();
                    if (fileExt === '.sql') {
                        allDDL += extractStructuralDDL(rawText) + '\n';
                    }
                } catch {
                    // Skip unreadable files
                }
            }

            const graph = buildDependencyGraph(allDDL);
            const dependencyGraphText = serializeGraphForPrompt(graph);
            const schemaGroups = extractSchemaGroups(graph);
            const schemaGroupsText = formatSchemaGroups(schemaGroups);
            ext.outputChannel.appendLog(
                `[Assessment] Dependency graph: ${graph.tables.length} tables, ${graph.edges.length} edges`,
            );

            // 3. Read access pattern files
            const accessPatternsPath = projectService.getAccessPatternsPath(project);
            const accessPatternFiles = await projectService.listFiles(accessPatternsPath);
            let accessPatternsText = '';
            for (const file of accessPatternFiles) {
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
                    accessPatternsText += `\n--- ${path.basename(file)} ---\n${Buffer.from(content).toString('utf-8')}\n`;
                } catch {
                    // Skip unreadable files
                }
            }

            if (token.isCancellationRequested) return;

            // ─── Phase 1: Access Pattern Extraction (AI) ─────────────────
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Phase 1/6: Extracting access patterns…'),
            );

            const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
            const assessmentDebugDir = path.join(assessmentPath, 'debug-prompts');

            const extractionResult = await runPromptWithJsonResult<{ accessPatterns: ParsedAccessPattern[] }>(
                Phase2Step0AccessPatternExtractionPrompt,
                { discoveryReport },
                model,
                token,
                'Assessment Phase 1 (Access Pattern Extraction)',
                l10n.t('Could not extract access patterns from discovery report.'),
                DEBUG_PROMPTS_ENABLED
                    ? { debugDir: assessmentDebugDir, stepName: 'step0-access-pattern-extraction' }
                    : undefined,
            );

            if (!extractionResult.accessPatterns || !Array.isArray(extractionResult.accessPatterns)) {
                throw new Error(l10n.t('Invalid extraction response: missing accessPatterns array.'));
            }

            const parsedAccessPatterns = extractionResult.accessPatterns;
            ext.outputChannel.appendLog(
                `[Assessment] Extracted ${parsedAccessPatterns.length} access patterns from discovery report`,
            );

            if (token.isCancellationRequested) return;

            // ─── Phase 2: Domain Identification (AI + DDD) ───────────────
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Phase 2/6: Identifying domains…'),
            );

            const phase1Result = await runPromptWithJsonResult<DomainIdentificationResult>(
                Phase2Step1AssessmentPrompt,
                {
                    dependencyGraph: dependencyGraphText,
                    discoveryReport,
                    accessPatterns: accessPatternsText,
                    bestPractices: getCosmosDbBestPractices(),
                    schemaGroups: schemaGroupsText,
                },
                model,
                token,
                'Assessment Phase 1 (Domain Identification)',
                l10n.t('Could not parse AI domain identification response.'),
                DEBUG_PROMPTS_ENABLED
                    ? { debugDir: assessmentDebugDir, stepName: 'step1-domain-identification' }
                    : undefined,
            );

            if (!phase1Result.domains || !Array.isArray(phase1Result.domains)) {
                throw new Error(l10n.t('Invalid assessment response: missing domains array.'));
            }

            ext.outputChannel.appendLog(`[Assessment] Phase 1: ${phase1Result.domains.length} domains identified`);

            // Assign pre-parsed access patterns to domains based on table overlap
            const domainsWithPatterns = assignAccessPatternsToDomains(phase1Result.domains, parsedAccessPatterns);
            for (const d of domainsWithPatterns) {
                const refsCount = d.accessPatterns.filter((ap) => ap.codeReferences.length > 0).length;
                ext.outputChannel.appendLog(
                    `[Assessment] Domain "${d.name}": ${d.accessPatterns.length} access patterns assigned (${refsCount} with code refs)`,
                );
            }

            // ─── Phase 3: Token Estimation (Programmatic) ────────────────
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Phase 3/6: Estimating token sizes…'),
            );

            const domainsWithTokens: DomainWithTokens[] = [];

            for (const domain of domainsWithPatterns) {
                if (token.isCancellationRequested) return;
                const subgraph = getSubgraphForTables(graph, domain.tables);
                const subgraphText = serializeGraphForPrompt(subgraph);
                const msg = vscode.LanguageModelChatMessage.User(subgraphText);
                const tokenCount = await model.countTokens(msg);
                domainsWithTokens.push({ ...domain, estimatedTokens: tokenCount });
                ext.outputChannel.appendLog(`[Assessment] Phase 2: "${domain.name}" = ${tokenCount} tokens`);
            }

            // ─── Phase 4: Domain Splitting (Conditional AI) ──────────────
            const TOKEN_THRESHOLD = 150_000;
            const oversizedDomains = domainsWithTokens.filter((d) => d.estimatedTokens > TOKEN_THRESHOLD);

            if (oversizedDomains.length > 0) {
                await sendPhaseProgress(
                    channel,
                    'Assessment',
                    'assessmentProgress',
                    l10n.t('Phase 4/6: Splitting {count} oversized domain(s)…', {
                        count: oversizedDomains.length,
                    }),
                );

                for (const domain of oversizedDomains) {
                    if (token.isCancellationRequested) return;

                    const subgraph = getSubgraphForTables(graph, domain.tables);
                    const subgraphText = serializeGraphForPrompt(subgraph);

                    try {
                        const splitResult = await runPromptWithJsonResult<{
                            subDomains: {
                                name: string;
                                description: string;
                                tables: string[];
                                rationale: string;
                                aggregateRoot: string;
                            }[];
                        }>(
                            Phase2Step2SplitDomainPrompt,
                            {
                                domainName: domain.name,
                                tableCount: domain.tables.length,
                                estimatedTokens: domain.estimatedTokens,
                                tokenThreshold: TOKEN_THRESHOLD,
                                subgraph: subgraphText,
                                bestPractices: getCosmosDbBestPractices(),
                            },
                            model,
                            token,
                            `Assessment Phase 3 (Split "${domain.name}")`,
                            undefined,
                            DEBUG_PROMPTS_ENABLED
                                ? {
                                      debugDir: assessmentDebugDir,
                                      stepName: sanitizeStepName(`step2-split-domain-${domain.name}`),
                                  }
                                : undefined,
                        );

                        if (splitResult.subDomains && Array.isArray(splitResult.subDomains)) {
                            const idx = domainsWithTokens.indexOf(domain);
                            domainsWithTokens.splice(idx, 1);

                            // Redistribute parent access patterns to sub-domains by table overlap
                            const parentPatterns = domain.accessPatterns ?? [];

                            for (const sub of splitResult.subDomains) {
                                const subGraph = getSubgraphForTables(graph, sub.tables);
                                const subMsg = vscode.LanguageModelChatMessage.User(serializeGraphForPrompt(subGraph));
                                const subTokens = await model.countTokens(subMsg);

                                const subTableSet = new Set(sub.tables.map((t) => t.toLowerCase()));
                                const redistributed = parentPatterns.filter((p) => {
                                    const overlap = p.tables.filter((t) => subTableSet.has(t.toLowerCase())).length;
                                    return overlap > 0;
                                });

                                domainsWithTokens.push({
                                    ...sub,
                                    estimatedTokens: subTokens,
                                    accessPatterns: redistributed,
                                });
                            }

                            ext.outputChannel.appendLog(
                                `[Assessment] Phase 3: Split "${domain.name}" into ${splitResult.subDomains.length} sub-domains`,
                            );
                        }
                    } catch {
                        // If splitting fails, keep the original domain
                    }
                }
            } else {
                await sendPhaseProgress(
                    channel,
                    'Assessment',
                    'assessmentProgress',
                    l10n.t('Phase 4/6: No oversized domains, skipping…'),
                );
            }

            // ─── Phase 5: Cross-Domain Analysis (AI) ─────────────────────
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Phase 5/6: Analyzing cross-domain dependencies…'),
            );

            const domainSummary = domainsWithTokens
                .map(
                    (d) =>
                        `- **${d.name}** (${d.tables.length} tables, ~${d.estimatedTokens.toLocaleString()} tokens): ${d.tables.join(', ')}`,
                )
                .join('\n');

            const tableToDomain = new Map<string, string>();
            for (const d of domainsWithTokens) {
                for (const t of d.tables) {
                    tableToDomain.set(t.toLowerCase(), d.name);
                }
            }

            const crossDomainEdges: string[] = [];
            for (const edge of graph.edges) {
                const fromDomain = tableToDomain.get(edge.fromTable.toLowerCase());
                const toDomain = tableToDomain.get(edge.toTable.toLowerCase());
                if (fromDomain && toDomain && fromDomain !== toDomain) {
                    crossDomainEdges.push(
                        `${edge.fromTable}.${edge.fromColumn} (${fromDomain}) → ${edge.toTable}.${edge.toColumn} (${toDomain})`,
                    );
                }
            }

            const crossDomainResult: CrossDomainResult = await runPromptWithJsonResult<CrossDomainResult>(
                Phase2Step3CrossDomainPrompt,
                {
                    domainSummary,
                    crossDomainEdges: crossDomainEdges.length > 0 ? crossDomainEdges.join('\n') : '',
                    bestPractices: getCosmosDbBestPractices(),
                },
                model,
                token,
                'Assessment Phase 4 (Cross-Domain)',
                undefined,
                DEBUG_PROMPTS_ENABLED ? { debugDir: assessmentDebugDir, stepName: 'step3-cross-domain' } : undefined,
            ).catch(() => ({
                crossDomainDependencies: [],
                domainRecommendations: {},
                summary: '',
            }));

            ext.outputChannel.appendLog(
                `[Assessment] Phase 4: ${crossDomainResult.crossDomainDependencies.length} cross-domain deps, ` +
                    `recommendations for ${Object.keys(crossDomainResult.domainRecommendations).length} domains`,
            );

            // ─── Persist domain files ─────────────────────────────────
            // Write domain markdown files now so they are available on disk
            // before the longer-running Phase 5 mapping detection.
            const domainFiles: {
                name: string;
                tables: string[];
                filePath: string;
                isMapped: boolean;
                estimatedTokens: number;
            }[] = [];
            for (const domain of domainsWithTokens) {
                const domainFilePath = path.join(assessmentPath, 'domains', `${domain.name}.md`);
                const recommendations = crossDomainResult.domainRecommendations[domain.name] ?? [];
                const deps = crossDomainResult.crossDomainDependencies
                    .filter((d) => d.relationship.includes(domain.name))
                    .map((d) => `${d.relationship}: ${d.strategy}`);
                const pathToRoot = path.relative(path.join(assessmentPath, 'domains'), workspaceRoot);
                const domainContent = formatDomainMarkdown(
                    {
                        ...domain,
                        crossDomainDependencies: deps,
                        recommendations,
                    },
                    pathToRoot,
                );
                await vscode.workspace.fs.writeFile(
                    vscode.Uri.file(domainFilePath),
                    Buffer.from(domainContent, 'utf-8'),
                );
                domainFiles.push({
                    name: domain.name,
                    tables: domain.tables,
                    filePath: domainFilePath,
                    isMapped: false,
                    estimatedTokens: domain.estimatedTokens,
                });
            }

            // ─── Phase 6: Domain Mapping Detection (AI + Tools) ──────────
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Phase 6/6: Checking domain mappings in source code…'),
            );

            const appAnalysis = project.phases.discovery.applicationAnalysis;
            const language = appAnalysis?.language ?? '';
            const frameworks = appAnalysis?.frameworks ?? [];

            const domainMappingResults = await detectDomainMappings(
                model,
                domainsWithTokens,
                language,
                frameworks,
                channel,
                token,
                assessmentDebugDir,
            );

            // Update isMapped on domainFiles from mapping results
            for (const df of domainFiles) {
                df.isMapped = domainMappingResults.get(df.name) ?? false;
            }

            // Save assessment summary (AI-generated)
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Generating assessment summary…'),
            );

            const domainFileList = domainFiles
                .map(
                    (df) =>
                        `- **${df.name}**: [domains/${path.basename(df.filePath)}](domains/${path.basename(df.filePath)})`,
                )
                .join('\n');

            const fullDomainSummary = domainsWithTokens
                .map(
                    (d) =>
                        `### ${d.name}\n${d.description}\n- **Tables (${d.tables.length}):** ${d.tables.join(', ')}\n- **Estimated Tokens:** ${d.estimatedTokens.toLocaleString()}`,
                )
                .join('\n\n');

            const crossDomainStrategies = crossDomainResult.crossDomainDependencies
                .map((dep) => `- ${dep.relationship}: ${dep.strategy}`)
                .join('\n');

            const domainRecommendationsText = Object.entries(crossDomainResult.domainRecommendations)
                .map(([name, recs]) => `### ${name}\n${recs.map((r) => `- ${r}`).join('\n')}`)
                .join('\n\n');

            const outputRelativePath = path.relative(workspaceRoot, summaryPath);

            const summaryContent = await runPrompt(
                Phase2Step5SummaryPrompt,
                {
                    domainFileList,
                    domainSummary: fullDomainSummary,
                    crossDomainEdges: crossDomainEdges.length > 0 ? crossDomainEdges.join('\n') : '',
                    crossDomainStrategies,
                    domainRecommendations: domainRecommendationsText,
                    outputRelativePath,
                },
                model,
                token,
                'Assessment Summary Generation',
                undefined,
                DEBUG_PROMPTS_ENABLED ? { debugDir: assessmentDebugDir, stepName: 'step5-summary' } : undefined,
            );
            await vscode.workspace.fs.writeFile(vscode.Uri.file(summaryPath), Buffer.from(summaryContent, 'utf-8'));

            // Update project.json
            project.phases.assessment = {
                status: 'complete',
                domains: domainsWithTokens.map((d) => ({
                    name: d.name,
                    tables: d.tables,
                    crossDomainDependencies: crossDomainResult.crossDomainDependencies
                        .filter((dep) => dep.relationship.includes(d.name))
                        .map((dep) => dep.relationship),
                    estimatedTokens: d.estimatedTokens,
                    isMapped: domainMappingResults.get(d.name) ?? false,
                })),
                parsedAccessPatterns,
                completedAt: new Date().toISOString(),
            };
            await projectService.save(project);

            await sendPhaseEvent(channel, 'assessmentCompleted', [
                {
                    domainFiles,
                    summaryFilePath: summaryPath,
                },
            ]);
        } catch (error) {
            if (assessmentCancellation?.token.isCancellationRequested) return;

            const errorMessage = error instanceof Error ? error.message : String(error);
            await sendPhaseEvent(channel, 'assessmentError', [errorMessage]);
        }
    });

    return { assessmentCancellation };
}

/**
 * Cancels an in-progress assessment operation.
 */
export async function cancelAssessment(
    assessmentCancellation: vscode.CancellationTokenSource | undefined,
    channel: Channel,
): Promise<vscode.CancellationTokenSource | undefined> {
    assessmentCancellation?.cancel();
    assessmentCancellation?.dispose();
    await sendPhaseEvent(channel, 'assessmentCancelled');
    return undefined;
}
