/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { MigrationProjectService, type ProjectJson } from '../../../services/MigrationProjectService';
import { extractStructuralDDL } from '../../../utils/ddlExtractor';
import { decodeFileBytes } from '../../../utils/decodeFileBytes';
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
    createMkDebug,
    getSelectedModel,
    isDebugPromptsEnabled,
    renderWithDebug,
    runAgenticLoop,
    runPrompt,
    runPromptWithJsonResult,
    stripMarkdownPreamble,
} from '../helpers/aiHelpers';
import { sanitizeStepName } from '../helpers/debugPromptHelpers';
import {
    assignAccessPatternsToDomains,
    formatDomainMarkdown,
    type ParsedAccessPattern,
    sendPhaseEvent,
    sendPhaseProgress,
} from '../helpers/migrationHelpers';
import {
    enrichErrorContext,
    incrementRunCount,
    setAiTelemetryContext,
    setMigrationTelemetryContext,
} from '../helpers/migrationTelemetry';
import { ASSESSMENT_TOKEN_THRESHOLD, MAX_TOOL_ROUNDS, PROMPT_OVERHEAD_TOKENS } from '../migrationConstants';
import {
    Phase2Step0AccessPatternExtractionPrompt,
    Phase2Step1AssessmentPrompt,
    Phase2Step2SplitDomainPrompt,
    Phase2Step3CrossDomainPrompt,
    Phase2Step4DomainMappingPrompt,
    Phase2Step5SummaryPrompt,
} from '../prompts';
import {
    createToolExecutor,
    getBestPracticeTools,
    getRegisteredChatTools,
    getWorkspaceTools,
} from '../tools/migrationTools';

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
    phaseContext?: IActionContext,
): Promise<Map<string, boolean>> {
    const results = new Map<string, boolean>();
    const customTools = [...getWorkspaceTools(), ...getBestPracticeTools()];
    const customToolNames = new Set(customTools.map((t) => t.name));
    const tools = [...getRegisteredChatTools(customToolNames), ...customTools];
    ext.outputChannel.appendLog(`[Assessment] Tools (${tools.length}):\n${tools.map((t) => `  ${t.name}`).join('\n')}`);
    const executeToolCall = createToolExecutor({}, '[Assessment]', { language, frameworks }, token, phaseContext);
    const mkDebug = createMkDebug(isDebugPromptsEnabled(), assessmentDebugDir);

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
                `[Assessment] Step 6: "${domain.name}" isMapped=true — known code references from discovery report`,
            );
            continue;
        }

        await sendPhaseProgress(
            channel,
            'Assessment',
            'assessmentProgress',
            l10n.t('Step 6/6: Checking mapping for "{domain}"…', { domain: domain.name }),
        );

        ext.outputChannel.appendLog(
            `[Assessment] Step 6: Checking mapping for domain "${domain.name}" (tables: ${domain.tables.join(', ')})`,
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

            const mappingStepName = sanitizeStepName(`step6-domain-mapping-${domain.name}`);

            const { messages: mappingMessages } = await renderWithDebug(
                Phase2Step4DomainMappingPrompt,
                mappingProps,
                model,
                token,
                mkDebug(mappingStepName),
            );

            const { text: fullText } = await runAgenticLoop(
                model,
                mappingMessages,
                tools,
                async (toolCall) => {
                    const input = toolCall.input as Record<string, string>;
                    const inputArg = input.filePath ?? input.pattern ?? '';
                    ext.outputChannel.appendLog(
                        `[Assessment] Step 6 "${domain.name}": Tool call ${toolCall.name}(${inputArg})`,
                    );
                    return executeToolCall(toolCall);
                },
                MAX_TOOL_ROUNDS,
                token,
                `Assessment Step 6 (Mapping "${domain.name}")`,

                (round, textChunk, isLastRound) => {
                    if (!isLastRound) {
                        ext.outputChannel.appendLog(
                            `[Assessment] Step 6 "${domain.name}": AI text (round ${round + 1}): ${textChunk.trim()}`,
                        );
                    }
                },
                undefined,
                mkDebug(mappingStepName),
            );

            const jsonMatch = fullText.match(/\{[^{}]*"isMapped"[^{}]*\}/);
            if (jsonMatch) {
                const parsed = JSON.parse(jsonMatch[0]) as { isMapped: boolean; evidence?: string };
                results.set(domain.name, parsed.isMapped === true);
                ext.outputChannel.appendLog(
                    `[Assessment] Step 6: "${domain.name}" isMapped=${String(parsed.isMapped)} — ${parsed.evidence ?? ''}`,
                );
            } else {
                results.set(domain.name, false);
                ext.outputChannel.appendLog(
                    `[Assessment] Step 6: "${domain.name}" — could not parse mapping result, defaulting to false`,
                );
            }
        } catch (e) {
            results.set(domain.name, false);
            ext.outputChannel.error(
                `[Assessment] Step 6: "${domain.name}" — error detecting mapping: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
    }

    const mappedCount = Array.from(results.values()).filter(Boolean).length;
    ext.outputChannel.appendLog(
        `[Assessment] Step 6 complete: ${mappedCount}/${domains.length} domains mapped in code`,
    );

    return results;
}

// ─── Main Entry Point ───────────────────────────────────────────────

export interface Phase2Context {
    project: ProjectJson;
    projectService: MigrationProjectService;
    channel: Channel;
    cancellationToken: vscode.CancellationToken;
}

/**
 * Phase 2: Domain decomposition assessment in 6 steps.
 *   Step 1 — Access Pattern Extraction (AI extraction from discovery report)
 *   Step 2 — Domain Identification (AI + DDD patterns)
 *   Step 3 — Token Estimation (programmatic via model.countTokens)
 *   Step 4 — Domain Splitting (conditional AI for domains > 150K tokens)
 *   Step 5 — Cross-Domain Analysis (AI for FK handling + recommendations)
 *   Step 6 — Domain Mapping Detection (AI + tools to check source code)
 */
export async function runAssessment(ctx: Phase2Context): Promise<void> {
    const { project, projectService, channel, cancellationToken: token } = ctx;

    await callWithTelemetryAndErrorHandling('cosmosDB.migration.phase2.assessment', async (context) => {
        setMigrationTelemetryContext(context, project, 'assessment');
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.forceIncludeInReportIssueCommand = true;
        incrementRunCount(project, 'assessment');
        // Check if assessment results already exist and ask for confirmation
        const assessmentPath = projectService.getAssessmentPath();
        const domainsPath = path.join(assessmentPath, 'domains');
        const summaryPath = path.join(assessmentPath, 'assessment-summary.md');
        let hasExisting = await MigrationProjectService.fileExists(vscode.Uri.file(summaryPath));
        if (!hasExisting) {
            try {
                const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(domainsPath));
                hasExisting = entries.length > 0;
            } catch {
                // Neither exists
            }
        }

        if (hasExisting) {
            const rerunItem: vscode.MessageItem = { title: l10n.t('Re-Run Assessment') };
            const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('Assessment results already exist. Re-running will overwrite them.'),
                { modal: true },
                rerunItem,
                cancelItem,
            );
            if (overwrite !== rerunItem) return;

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

        try {
            const model = await getSelectedModel();
            setAiTelemetryContext(context, model);

            ext.outputChannel.appendLog(
                `[Assessment] Selected model: id="${model.id}", name="${model.name}", maxInputTokens=${model.maxInputTokens}`,
            );

            const assessmentStartTime = Date.now();
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
            const schemaFiles = await projectService.listDiscoveryFiles(project, 'schema-ddl');
            let allDDL = '';
            for (const file of schemaFiles) {
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
                    const rawText = decodeFileBytes(content).text;
                    const fileExt = path.extname(file).toLowerCase();
                    if (fileExt === '.sql') {
                        allDDL += extractStructuralDDL(rawText).sql + '\n';
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
            const accessPatternFiles = await projectService.listDiscoveryFiles(project, 'access-patterns');
            ext.outputChannel.debug(
                `[Assessment] Input sizes: discoveryReport=${discoveryReport.length} chars, ` +
                    `DDL=${allDDL.length} chars, schemaFiles=${schemaFiles.length}, ` +
                    `accessPatternFiles=${accessPatternFiles.length}`,
            );
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

            // ─── Step 1: Access Pattern Extraction (AI) ───────────────────
            context.telemetry.properties.lastStep = 'step1.accessPatternExtraction';
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Step 1/6: Extracting access patterns…'),
            );

            const workspaceRoot = projectService.getWorkspacePath();
            const assessmentDebugDir = path.join(assessmentPath, 'debug-prompts');
            const mkDebug = createMkDebug(isDebugPromptsEnabled(), assessmentDebugDir);

            const discoveryInstructions = project.phases.discovery.discoveryInstructions ?? '';

            const extractionResult = await runPromptWithJsonResult<{ accessPatterns: ParsedAccessPattern[] }>(
                Phase2Step0AccessPatternExtractionPrompt,
                {
                    discoveryReport,
                    discoveryInstructions,
                    assessmentInstructions: project.phases.assessment?.assessmentInstructions ?? '',
                },
                model,
                token,
                'Assessment Step 1 (Access Pattern Extraction)',
                l10n.t('Could not extract access patterns from discovery report.'),
                mkDebug('step1-access-pattern-extraction'),
            );

            if (!extractionResult.accessPatterns || !Array.isArray(extractionResult.accessPatterns)) {
                throw new Error(l10n.t('Invalid extraction response: missing accessPatterns array.'));
            }

            const parsedAccessPatterns = extractionResult.accessPatterns;
            ext.outputChannel.appendLog(
                `[Assessment] Extracted ${parsedAccessPatterns.length} access patterns from discovery report`,
            );

            if (token.isCancellationRequested) return;

            // ─── Step 2: Domain Identification (AI + DDD) ─────────────────
            context.telemetry.properties.lastStep = 'step2.domainIdentification';
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Step 2/6: Identifying domains…'),
            );

            const domainIdentificationResult = await runPromptWithJsonResult<DomainIdentificationResult>(
                Phase2Step1AssessmentPrompt,
                {
                    dependencyGraph: dependencyGraphText,
                    discoveryReport,
                    discoveryInstructions,
                    accessPatterns: accessPatternsText,
                    bestPractices: getCosmosDbBestPractices(),
                    schemaGroups: schemaGroupsText,
                    assessmentInstructions: project.phases.assessment?.assessmentInstructions ?? '',
                },
                model,
                token,
                'Assessment Step 2 (Domain Identification)',
                l10n.t('Could not parse AI domain identification response.'),
                mkDebug('step2-domain-identification'),
            );

            if (!domainIdentificationResult.domains || !Array.isArray(domainIdentificationResult.domains)) {
                throw new Error(l10n.t('Invalid assessment response: missing domains array.'));
            }

            ext.outputChannel.appendLog(
                `[Assessment] Step 2: ${domainIdentificationResult.domains.length} domains identified`,
            );
            ext.outputChannel.debug(
                `[Assessment] Domains: ${domainIdentificationResult.domains.map((d) => `${d.name}(${d.tables.length} tables)`).join(', ')}`,
            );

            // Assign pre-parsed access patterns to domains based on table overlap
            const domainsWithPatterns = assignAccessPatternsToDomains(
                domainIdentificationResult.domains,
                parsedAccessPatterns,
            );
            for (const d of domainsWithPatterns) {
                const refsCount = d.accessPatterns.filter((ap) => ap.codeReferences.length > 0).length;
                ext.outputChannel.appendLog(
                    `[Assessment] Domain "${d.name}": ${d.accessPatterns.length} access patterns assigned (${refsCount} with code refs)`,
                );
            }

            // ─── Step 3: Token Estimation (Programmatic) ──────────────────
            context.telemetry.properties.lastStep = 'step3.tokenEstimation';
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Step 3/6: Estimating token sizes…'),
            );

            // Count best practices tokens once — included in every Step 3 prompt
            const bestPracticesText = getCosmosDbBestPractices();
            const bestPracticesTokens = await model.countTokens(
                vscode.LanguageModelChatMessage.User(bestPracticesText),
            );

            ext.outputChannel.appendLog(
                `[Assessment] Token estimation overhead: bestPractices=${bestPracticesTokens}, promptOverhead=${PROMPT_OVERHEAD_TOKENS}`,
            );

            const domainsWithTokens: DomainWithTokens[] = [];

            for (const domain of domainsWithPatterns) {
                if (token.isCancellationRequested) return;
                // Pre-pass: generate domain markdown with data available now
                // (cross-domain deps and recommendations not yet known)
                const prePassMarkdown = formatDomainMarkdown({
                    ...domain,
                    crossDomainDependencies: [],
                    recommendations: [],
                    estimatedTokens: 0,
                });
                const markdownTokens = await model.countTokens(vscode.LanguageModelChatMessage.User(prePassMarkdown));
                const totalTokens = markdownTokens + bestPracticesTokens + PROMPT_OVERHEAD_TOKENS;
                domainsWithTokens.push({ ...domain, estimatedTokens: totalTokens });
                ext.outputChannel.appendLog(
                    `[Assessment] Token estimate "${domain.name}": markdown=${markdownTokens}, bestPractices=${bestPracticesTokens}, overhead=${PROMPT_OVERHEAD_TOKENS}, total=${totalTokens}`,
                );
            }

            // ─── Step 4: Domain Splitting (Conditional AI) ────────────────
            context.telemetry.properties.lastStep = 'step4.domainSplitting';
            const oversizedDomains = domainsWithTokens.filter((d) => d.estimatedTokens > ASSESSMENT_TOKEN_THRESHOLD);

            if (oversizedDomains.length > 0) {
                await sendPhaseProgress(
                    channel,
                    'Assessment',
                    'assessmentProgress',
                    l10n.t('Step 4/6: Splitting {count} oversized domain(s)…', {
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
                                tokenThreshold: ASSESSMENT_TOKEN_THRESHOLD,
                                subgraph: subgraphText,
                                bestPractices: getCosmosDbBestPractices(),
                            },
                            model,
                            token,
                            `Assessment Step 4 (Split "${domain.name}")`,
                            undefined,
                            mkDebug(sanitizeStepName(`step4-split-domain-${domain.name}`)),
                        );

                        if (splitResult.subDomains && Array.isArray(splitResult.subDomains)) {
                            const idx = domainsWithTokens.indexOf(domain);
                            domainsWithTokens.splice(idx, 1);

                            // Redistribute parent access patterns to sub-domains by table overlap
                            const parentPatterns = domain.accessPatterns ?? [];

                            for (const sub of splitResult.subDomains) {
                                const subTableSet = new Set(sub.tables.map((t) => t.toLowerCase()));
                                const redistributed = parentPatterns.filter((p) => {
                                    const overlap = p.tables.filter((t) => subTableSet.has(t.toLowerCase())).length;
                                    return overlap > 0;
                                });

                                // Pre-pass estimation matching Step 3 context
                                const subPrePassMarkdown = formatDomainMarkdown({
                                    ...sub,
                                    crossDomainDependencies: [],
                                    recommendations: [],
                                    estimatedTokens: 0,
                                    accessPatterns: redistributed,
                                });
                                const subMarkdownTokens = await model.countTokens(
                                    vscode.LanguageModelChatMessage.User(subPrePassMarkdown),
                                );
                                const subTokens = subMarkdownTokens + bestPracticesTokens + PROMPT_OVERHEAD_TOKENS;

                                domainsWithTokens.push({
                                    ...sub,
                                    estimatedTokens: subTokens,
                                    accessPatterns: redistributed,
                                });
                            }

                            ext.outputChannel.appendLog(
                                `[Assessment] Step 4: Split "${domain.name}" into ${splitResult.subDomains.length} sub-domains`,
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
                    l10n.t('Step 4/6: No oversized domains, skipping…'),
                );
            }

            // ─── Step 5: Cross-Domain Analysis (AI) ───────────────────────
            context.telemetry.properties.lastStep = 'step5.crossDomainAnalysis';
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Step 5/6: Analyzing cross-domain dependencies…'),
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
                'Assessment Step 5 (Cross-Domain)',
                undefined,
                mkDebug('step5-cross-domain'),
            ).catch(() => ({
                crossDomainDependencies: [],
                domainRecommendations: {},
                summary: '',
            }));

            ext.outputChannel.appendLog(
                `[Assessment] Step 5: ${crossDomainResult.crossDomainDependencies.length} cross-domain deps, ` +
                    `recommendations for ${Object.keys(crossDomainResult.domainRecommendations).length} domains`,
            );

            // ─── Persist domain files ─────────────────────────────────
            // Write domain markdown files now so they are available on disk
            // before the longer-running Step 6 mapping detection.
            const appAnalysisForLang = project.phases.discovery.applicationAnalysis;
            const detectedLanguage = appAnalysisForLang?.language ?? '';

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

                // Re-estimate tokens on finalized content (now includes cross-domain deps + recommendations)
                const preliminaryMarkdown = formatDomainMarkdown(
                    {
                        ...domain,
                        crossDomainDependencies: deps,
                        recommendations,
                        estimatedTokens: 0, // placeholder — will be replaced below
                    },
                    pathToRoot,
                    detectedLanguage,
                );
                const finalMarkdownTokens = await model.countTokens(
                    vscode.LanguageModelChatMessage.User(preliminaryMarkdown),
                );
                const finalEstimate = finalMarkdownTokens + bestPracticesTokens + PROMPT_OVERHEAD_TOKENS;
                domain.estimatedTokens = finalEstimate;

                // Generate the final markdown with the accurate token estimate in the heading
                const domainContent = formatDomainMarkdown(
                    {
                        ...domain,
                        crossDomainDependencies: deps,
                        recommendations,
                    },
                    pathToRoot,
                    detectedLanguage,
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
                    estimatedTokens: finalEstimate,
                });
            }

            // ─── Step 6: Domain Mapping Detection (AI + Tools) ────────────
            context.telemetry.properties.lastStep = 'step6.domainMapping';
            await sendPhaseProgress(
                channel,
                'Assessment',
                'assessmentProgress',
                l10n.t('Step 6/6: Checking domain mappings in source code…'),
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
                context,
            );

            ext.outputChannel.debug(`[Assessment] Total assessment elapsed: ${Date.now() - assessmentStartTime}ms`);

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
                mkDebug('summary'),
            );
            await vscode.workspace.fs.writeFile(
                vscode.Uri.file(summaryPath),
                Buffer.from(stripMarkdownPreamble(summaryContent), 'utf-8'),
            );

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

            // Structural metrics
            context.telemetry.measurements.domainCount = domainsWithTokens.length;
            context.telemetry.measurements.accessPatternCount = parsedAccessPatterns.length;

            await sendPhaseEvent(channel, 'assessmentCompleted', [
                {
                    domainFiles,
                    summaryFilePath: summaryPath,
                },
            ]);
        } catch (error) {
            if (token.isCancellationRequested) throw new vscode.CancellationError();

            enrichErrorContext(context, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            await sendPhaseEvent(channel, 'assessmentError', [errorMessage]);
            throw error;
        }
    });
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
