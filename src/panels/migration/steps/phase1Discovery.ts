/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { renderPrompt } from '@vscode/prompt-tsx';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ext } from '../../../extensionVariables';
import { MigrationProjectService, type ProjectJson } from '../../../services/MigrationProjectService';
import { type Channel } from '../../Communication/Channel/Channel';
import {
    createMkDebug,
    getSelectedModel,
    isDebugPromptsEnabled,
    renderWithDebug,
    runAgenticLoop,
    runPromptWithJsonResult,
    stripMarkdownPreamble,
} from '../helpers/aiHelpers';
import { sendPhaseEvent } from '../helpers/migrationHelpers';
import {
    enrichErrorContext,
    incrementRunCount,
    setAiTelemetryContext,
    setMigrationTelemetryContext,
} from '../helpers/migrationTelemetry';
import {
    AGENTIC_OVERHEAD_TOKENS,
    MANIFEST_PREVIEW_CHARS,
    SCHEMA_PREVIEW_CHARS_PER_FILE,
    SCHEMA_PREVIEW_FILE_LIMIT,
} from '../migrationConstants';
import {
    ApplicationDetailsPrompt,
    buildAnalyzeAccessPatternsPrompt,
    buildAnalyzeVolumetricsPrompt,
    buildChatDiscoveryPrompt,
    Phase1Step2DiscoveryPrompt,
} from '../prompts';
import { getAccessPatternsTemplateContent } from '../templates/accessPatternsTemplate';
import { getVolumetricsTemplateContent } from '../templates/volumetricsTemplate';
import {
    CHARS_PER_TOKEN,
    createToolExecutor,
    DEFAULT_SOURCE_PATTERN,
    getAllDiscoveryTools,
    getBestPracticeTools,
    getRegisteredChatTools,
    getWorkspaceFileExclude,
    MAX_FILE_TOKENS,
} from '../tools/migrationTools';

// ─── Feature Toggle ──────────────────────────────────────────────────

/**
 * When `true`, the discovery report is generated via Copilot Chat (Chat window)
 * using `#file:` links instead of the raw LLM agentic tool-calling loop.
 * Set to `true` to test the Chat-based alternative path.
 */
const USE_CHAT_DISCOVERY = false;

// ─── Types ───────────────────────────────────────────────────────────

interface AnalysisResult {
    projectName?: string;
    projectType?: string;
    language?: string;
    frameworks?: string[];
    databaseType?: string;
    databaseAccess?: string;
}

// ─── Workspace Context ──────────────────────────────────────────────

/**
 * Scans the workspace for project manifest and configuration files
 * to provide application-level context (language, frameworks, project type).
 */
export async function gatherWorkspaceContext(): Promise<string> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return '';

    const manifestPatterns = [
        '**/*.csproj',
        '**/*.fsproj',
        '**/*.vbproj',
        '**/*.sln',
        '**/package.json',
        '**/pom.xml',
        '**/build.gradle',
        '**/build.gradle.kts',
        '**/Cargo.toml',
        '**/go.mod',
        '**/requirements.txt',
        '**/Pipfile',
        '**/pyproject.toml',
        '**/Gemfile',
        '**/composer.json',
    ];

    const configPatterns = [
        '**/appsettings.json',
        '**/Startup.cs',
        '**/Program.cs',
        '**/application.properties',
        '**/application.yml',
        '**/tsconfig.json',
        '**/web.config',
    ];

    let context = '';
    const allPatterns = [...manifestPatterns, ...configPatterns];
    const exclude = '**/node_modules/**,**/bin/**,**/obj/**,**/dist/**,**/.cosmosdb-migration/**';

    for (const pattern of allPatterns) {
        const files = await vscode.workspace.findFiles(pattern, exclude, 3);
        for (const file of files) {
            try {
                const content = await vscode.workspace.fs.readFile(file);
                const relativePath = vscode.workspace.asRelativePath(file);
                const text = Buffer.from(content).toString('utf-8').slice(0, MANIFEST_PREVIEW_CHARS);
                context += `\n--- ${relativePath} ---\n${text}\n`;
            } catch {
                // Skip unreadable files
            }
        }
    }

    return context;
}

// ─── Pre-read Helpers ───────────────────────────────────────────────

/**
 * Reads a single file by its basename from a list of absolute paths.
 * Returns the file content as a string, or undefined if not found or unreadable.
 */
async function readFileByName(filePaths: string[], fileName: string): Promise<string | undefined> {
    const absolutePath = filePaths.find((f) => path.basename(f) === fileName);
    if (!absolutePath) return undefined;
    try {
        const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
        return Buffer.from(content).toString('utf-8');
    } catch {
        return undefined;
    }
}

/**
 * Markdown link pattern: matches `[text](url)` anywhere in a string.
 */
const MARKDOWN_LINK_RE = /\[.*?\]\(.*?\)/;

/**
 * Parses a filled-in access-patterns.md and extracts the table/entity names
 * from rows that contain at least one markdown file link (code evidence).
 *
 * The template uses pipe-delimited table rows like:
 * | R001 | Get order by ID | Orders, OrderItems | ... | ... | ... | [OrderRepo.ts](../../src/...) |
 *
 * A row is considered code-evidenced if ANY cell contains a markdown link.
 * Table names are extracted from the "Tables / Entities" column (3rd field).
 */
export function parseCodeEvidencedTables(mdContent: string): string[] {
    const tables = new Set<string>();
    const lines = mdContent.split('\n');

    for (const line of lines) {
        // Must be a pipe-delimited table row (not a header separator)
        if (!line.includes('|') || /^\s*\|[\s-:|]+\|\s*$/.test(line)) continue;

        // Must contain a markdown link somewhere in the row
        if (!MARKDOWN_LINK_RE.test(line)) continue;

        // Split into cells (trim outer pipes)
        const cells = line.split('|').map((c) => c.trim());
        // Pipe-split with leading/trailing pipes gives empty first/last elements
        const filteredCells = cells.filter((c) => c.length > 0);

        // Need at least 3 columns: ID, Pattern Name, Tables/Entities
        if (filteredCells.length < 3) continue;

        // The first cell must look like a pattern ID (R### or W###)
        if (!/^[RW]\d{3}\b/.test(filteredCells[0])) continue;

        // Third column = Tables / Entities
        const tablesCell = filteredCells[2];
        for (const table of tablesCell.split(',')) {
            const trimmed = table.trim();
            if (trimmed.length > 0) {
                tables.add(trimmed);
            }
        }
    }

    return Array.from(tables);
}

// ─── Chat-Based Discovery (alternative path) ───────────────────────

/**
 * Dispatches the discovery prompt to Copilot Chat instead of running the
 * agentic tool-calling loop. All input files are referenced via `#file:`
 * links so Chat resolves their content natively.
 */
async function dispatchChatDiscovery(
    schemaFiles: string[],
    volumetricFiles: string[],
    accessPatternFiles: string[],
    projectService: MigrationProjectService,
    project: ProjectJson,
    analysis: AnalysisResult,
): Promise<void> {
    const workspaceRoot = projectService.getWorkspacePath();
    const discoveryDir = projectService.getDiscoveryPath();
    const outputRelativePath = path.relative(workspaceRoot, path.join(discoveryDir, 'discovery-report.md'));

    // Convert absolute paths to workspace-relative for #file: links
    const schemaFileRefs = schemaFiles.map((f) => path.relative(workspaceRoot, f));

    // Separate access-patterns.md from other access-pattern files
    const accessPatternsMdAbsPath = accessPatternFiles.find((f) => path.basename(f) === 'access-patterns.md');
    const accessPatternsMdPath = accessPatternsMdAbsPath
        ? path.relative(workspaceRoot, accessPatternsMdAbsPath)
        : undefined;
    const accessPatternFileRefs = accessPatternFiles
        .filter((f) => path.basename(f) !== 'access-patterns.md')
        .map((f) => path.relative(workspaceRoot, f));

    // Separate volumetrics.md from other volumetric files
    const volumetricsMdAbsPath = volumetricFiles.find((f) => path.basename(f) === 'volumetrics.md');
    const volumetricsMdPath = volumetricsMdAbsPath ? path.relative(workspaceRoot, volumetricsMdAbsPath) : undefined;
    const volumetricFileRefs = volumetricFiles
        .filter((f) => path.basename(f) !== 'volumetrics.md')
        .map((f) => path.relative(workspaceRoot, f));

    // Parse code-evidenced tables from access-patterns.md (if it exists)
    let codeEvidencedTables: string[] = [];
    if (accessPatternsMdAbsPath) {
        const content = await readFileByName(accessPatternFiles, 'access-patterns.md');
        if (content) {
            codeEvidencedTables = parseCodeEvidencedTables(content);
        }
    }

    const prompt = buildChatDiscoveryPrompt({
        schemaFileRefs,
        accessPatternsMdPath,
        accessPatternFileRefs: accessPatternFileRefs.length > 0 ? accessPatternFileRefs : undefined,
        volumetricsMdPath,
        volumetricFileRefs: volumetricFileRefs.length > 0 ? volumetricFileRefs : undefined,
        codeEvidencedTables,
        outputRelativePath,
        language: analysis.language ?? '',
        frameworks: analysis.frameworks ?? [],
        databaseType: analysis.databaseType ?? '',
        databaseAccess: analysis.databaseAccess ?? '',
        discoveryInstructions: project.phases.discovery.discoveryInstructions,
    });

    await vscode.commands.executeCommand('workbench.action.chat.open', {
        // Custom .agent.md entries are resolved in Agent mode.
        mode: 'agent',
        query: prompt,
    });
}

// ─── Discovery Report Generation ────────────────────────────────────

/**
 * Generates a discovery report using an agentic tool-calling loop.
 * The model discovers and reads all files via tools — no content is embedded
 * in the prompt. The result is saved as discovery-report.md in the discovery
 * phase root.
 */
async function generateDiscoveryReport(
    model: vscode.LanguageModelChat,
    schemaFiles: string[],
    volumetricFiles: string[],
    accessPatternFiles: string[],
    projectService: MigrationProjectService,
    project: ProjectJson,
    token: vscode.CancellationToken,
    analysis: AnalysisResult,
    discoveryInstructions?: string,
): Promise<void> {
    // Pre-parse code-evidenced tables from access-patterns.md (if it exists)
    const accessPatternsMdContent = await readFileByName(accessPatternFiles, 'access-patterns.md');
    const codeEvidencedTables = accessPatternsMdContent ? parseCodeEvidencedTables(accessPatternsMdContent) : [];

    const hasAccessPatternsMd = !!accessPatternsMdContent;
    const volumetricsMdContent = await readFileByName(volumetricFiles, 'volumetrics.md');

    const customTools = [...getAllDiscoveryTools(), ...getBestPracticeTools()];
    const customToolNames = new Set(customTools.map((t) => t.name));
    const tools = [...getRegisteredChatTools(customToolNames), ...customTools];
    ext.outputChannel.appendLog(`[Discovery] Tools (${tools.length}):\n${tools.map((t) => `  ${t.name}`).join('\n')}`);
    ext.outputChannel.debug(
        `[Discovery] Report generation: schemaFiles=${schemaFiles.length}, ` +
            `accessPatternFiles=${accessPatternFiles.length}, volumetricFiles=${volumetricFiles.length}`,
    );
    const reportStartTime = Date.now();
    const executeToolCall = createToolExecutor(
        { schemaFiles, accessPatternFiles },
        '[Discovery]',
        { language: analysis.language, frameworks: analysis.frameworks },
        token,
    );

    const discoveryDir = projectService.getDiscoveryPath();
    const workspaceRoot = projectService.getWorkspacePath();
    const outputRelativePath = path.relative(workspaceRoot, path.join(discoveryDir, 'discovery-report.md'));

    const mkDebug = createMkDebug(isDebugPromptsEnabled(), path.join(discoveryDir, 'debug-prompts'));
    const step2Props = {
        hasAccessPatternFiles: accessPatternFiles.length > 0,
        hasAccessPatternsMd,
        volumetricsMdContent,
        codeEvidencedTables,
        outputRelativePath,
        language: analysis.language ?? '',
        frameworks: analysis.frameworks ?? [],
        databaseType: analysis.databaseType ?? '',
        databaseAccess: analysis.databaseAccess ?? '',
        discoveryInstructions: discoveryInstructions ?? '',
    };

    const { messages, inputTokenCount } = await renderWithDebug(
        Phase1Step2DiscoveryPrompt,
        step2Props,
        model,
        token,
        mkDebug('step2-discovery'),
    );

    ext.outputChannel.appendLog(
        `[Discovery] Post-render: inputTokenCount=${inputTokenCount}, budget=${model.maxInputTokens}` +
            ` (${Math.round((inputTokenCount / model.maxInputTokens) * 100)}% used)`,
    );

    const { text: fullText } = await runAgenticLoop(
        model,
        messages,
        tools,
        async (toolCall) => {
            const input = toolCall.input as Record<string, string>;
            const inputArg = input.fileName ?? input.filePath ?? input.pattern ?? '';
            ext.outputChannel.info(`[Discovery] Tool call: ${toolCall.name}(${inputArg})`);
            return executeToolCall(toolCall);
        },
        30,
        token,
        'Discovery',
        (round, textChunk, isLastRound) => {
            if (!isLastRound) {
                ext.outputChannel.appendLog(`[Discovery] AI text (round ${round + 1}): ${textChunk.trim()}`);
            }
        },
        undefined,
        mkDebug('step2-discovery'),
    );

    if (token.isCancellationRequested || !fullText.trim()) return;

    ext.outputChannel.debug(
        `[Discovery] Report generation completed in ${Date.now() - reportStartTime}ms, ` +
            `responseLength=${fullText.length} chars`,
    );

    // Save discovery report (strip any LLM preamble before the first heading)
    const outputPath = path.join(discoveryDir, 'discovery-report.md');
    await vscode.workspace.fs.writeFile(
        vscode.Uri.file(outputPath),
        Buffer.from(stripMarkdownPreamble(fullText), 'utf-8'),
    );

    await projectService.save(project);
}

// ─── Token Estimation ───────────────────────────────────────────────

/**
 * Estimates the min/max token usage for the Phase 1 discovery agentic loop.
 *
 * **minTokens**: The token count of the prompt including any embedded
 * volumetric data (volumetrics.md is the only file embedded in the prompt).
 *
 * **maxTokens**: minTokens plus worst-case tool-loaded content:
 * - All schema files (read via readSchemaFile)
 * - All access-pattern files (read via readAccessPatternFile)
 * - Workspace source files (actual count via findFiles × MAX_FILE_TOKENS)
 * - Agentic overhead (per-round metadata across 30 rounds)
 */
export async function estimateDiscoveryTokens(
    projectService: MigrationProjectService,
    project: ProjectJson,
    model: vscode.LanguageModelChat,
    token: vscode.CancellationToken,
): Promise<{ minTokens: number; maxTokens: number } | null> {
    const schemaPath = projectService.getSchemaPath(project);
    const schemaFiles = await projectService.listFiles(schemaPath);
    if (schemaFiles.length === 0) return null;

    const accessPatternsPath = projectService.getAccessPatternsPath(project);
    const accessPatternFiles = await projectService.listFiles(accessPatternsPath);
    const volumetricsPath = projectService.getVolumetricsPath(project);
    const volumetricFiles = await projectService.listFiles(volumetricsPath);

    // Build the same props that generateDiscoveryReport uses
    const accessPatternsMdContent = await readFileByName(accessPatternFiles, 'access-patterns.md');
    const codeEvidencedTables = accessPatternsMdContent ? parseCodeEvidencedTables(accessPatternsMdContent) : [];
    const volumetricsMdContent = await readFileByName(volumetricFiles, 'volumetrics.md');

    const analysis = (project.phases.discovery.applicationAnalysis as AnalysisResult | undefined) ?? {};
    const discoveryDir = projectService.getDiscoveryPath();
    const workspaceRoot = projectService.getWorkspacePath();
    const outputRelativePath = path.relative(workspaceRoot, path.join(discoveryDir, 'discovery-report.md'));

    const step2Props = {
        hasAccessPatternFiles: accessPatternFiles.length > 0,
        hasAccessPatternsMd: !!accessPatternsMdContent,
        volumetricsMdContent,
        codeEvidencedTables,
        outputRelativePath,
        language: analysis.language ?? '',
        frameworks: analysis.frameworks ?? [],
        databaseType: analysis.databaseType ?? '',
        databaseAccess: analysis.databaseAccess ?? '',
        discoveryInstructions: project.phases.discovery.discoveryInstructions ?? '',
    };

    // minTokens: prompt with embedded volumetric data (if any)
    const { tokenCount: minTokens } = await renderPrompt(
        Phase1Step2DiscoveryPrompt,
        step2Props,
        { modelMaxPromptTokens: Number.MAX_SAFE_INTEGER },
        model,
        undefined,
        token,
    );
    ext.outputChannel.appendLog(
        `[Discovery] Prompt: ${minTokens} tokens` +
            ` (${Math.round((minTokens / model.maxInputTokens) * 100)}% of ${model.maxInputTokens} budget)`,
    );

    // maxTokens: add worst-case tool-loaded content
    let additionalTokens = 0;

    // All schema files (loaded via tools, not embedded)
    for (const absolutePath of schemaFiles) {
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
            additionalTokens += await model.countTokens(Buffer.from(content).toString('utf-8'));
        } catch {
            // Skip unreadable files
        }
    }

    // All access-pattern files (loaded via tools, not embedded)
    for (const absolutePath of accessPatternFiles) {
        try {
            const content = await vscode.workspace.fs.readFile(vscode.Uri.file(absolutePath));
            additionalTokens += await model.countTokens(Buffer.from(content).toString('utf-8'));
        } catch {
            // Skip unreadable files
        }
    }

    // Workspace source files: use actual file sizes (capped at tool truncation limit) / 4
    const workspaceExclude = getWorkspaceFileExclude(analysis.language, analysis.frameworks);
    const workspaceFiles = await vscode.workspace.findFiles(DEFAULT_SOURCE_PATTERN, workspaceExclude);
    for (const uri of workspaceFiles) {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            // stat.size is bytes; ≈ chars for source code (mostly ASCII).
            // Cap at MAX_FILE_CHARS since readWorkspaceFile truncates there.
            // Cap at MAX_FILE_TOKENS since readWorkspaceFile truncates there.
            additionalTokens += Math.min(Math.ceil(stat.size / CHARS_PER_TOKEN), MAX_FILE_TOKENS);
        } catch {
            // Skip unreadable files
        }
    }

    additionalTokens += AGENTIC_OVERHEAD_TOKENS;

    return { minTokens: minTokens, maxTokens: minTokens + additionalTokens };
}

// ─── Main Entry Point ───────────────────────────────────────────────

export interface Phase1Context {
    project: ProjectJson;
    projectService: MigrationProjectService;
    channel: Channel;
    cancellationToken: vscode.CancellationToken;
}

/**
 * Step 1: AI-powered application analysis (Auto-Detect).
 * Identifies project type, language, frameworks, DB type from workspace and schema files.
 * Does NOT generate the discovery report.
 */
export async function runApplicationAnalysis(ctx: Phase1Context): Promise<void> {
    const { project, projectService, channel, cancellationToken: token } = ctx;

    await callWithTelemetryAndErrorHandling('cosmosDB.migration.phase1.analysis', async (context) => {
        setMigrationTelemetryContext(context, project, 'discovery');
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.forceIncludeInReportIssueCommand = true;
        try {
            const model = await getSelectedModel();
            setAiTelemetryContext(context, model);

            ext.outputChannel.appendLog(
                `[Migration] Selected model: id="${model.id}", name="${model.name}", family="${model.family}", maxInputTokens=${model.maxInputTokens}`,
            );

            await sendPhaseEvent(channel, 'analysisStarted');

            if (token.isCancellationRequested) return;

            // Read schema files for context
            const schemaPath = projectService.getSchemaPath(project);
            const schemaFiles = await projectService.listFiles(schemaPath);
            const schemaFileTypes = [
                ...new Set(schemaFiles.map((f) => path.extname(f).replace('.', '')).filter(Boolean)),
            ];
            ext.outputChannel.debug(
                `[Discovery] Application analysis: ${schemaFiles.length} schema files ` +
                    `(types: ${schemaFileTypes.join(', ') || 'none'})`,
            );
            const analysisStartTime = Date.now();
            let schemaContext = '';
            for (const file of schemaFiles.slice(0, SCHEMA_PREVIEW_FILE_LIMIT)) {
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
                    const fileName = path.basename(file);
                    schemaContext += `\n--- ${fileName} ---\n${Buffer.from(content).toString('utf-8').slice(0, SCHEMA_PREVIEW_CHARS_PER_FILE)}\n`;
                } catch {
                    // Skip unreadable files
                }
            }

            const workspaceContext = await gatherWorkspaceContext();

            const mkDebug = createMkDebug(
                isDebugPromptsEnabled(),
                path.join(projectService.getDiscoveryPath(), 'debug-prompts'),
            );

            const analysis = await runPromptWithJsonResult<AnalysisResult>(
                ApplicationDetailsPrompt,
                { schemaContext, schemaFileTypes, workspaceContext },
                model,
                token,
                'Analysis',
                undefined,
                mkDebug('step1-analysis'),
            );

            ext.outputChannel.debug(
                `[Discovery] Application analysis completed in ${Date.now() - analysisStartTime}ms: ` +
                    `language=${analysis.language ?? 'unknown'}, ` +
                    `frameworks=[${(analysis.frameworks ?? []).join(', ')}], ` +
                    `databaseType=${analysis.databaseType ?? 'unknown'}`,
            );

            // Update project.json
            project.phases.discovery.applicationAnalysis = {
                ...analysis,
                // Never leave frameworks empty — downstream UI treats it as a required field.
                // Some projects legitimately have no frameworks; mark as "N/A" instead.
                frameworks: analysis.frameworks && analysis.frameworks.length > 0 ? analysis.frameworks : ['N/A'],
                completedAt: new Date().toISOString(),
            };
            project.phases.discovery.status = 'in-progress';
            await projectService.save(project);

            await sendPhaseEvent(channel, 'analysisCompleted', [analysis]);
        } catch (error) {
            if (token.isCancellationRequested) throw new vscode.CancellationError();

            enrichErrorContext(context, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(`[Migration] Application analysis failed: ${errorMessage}`);
            await sendPhaseEvent(channel, 'analysisError', [errorMessage]);
            throw error;
        }
    });
}

/**
 * Step 2: Discovery report generation via agentic tool-calling loop.
 * Requires application analysis fields (from AI or manual entry) to be populated.
 */
export async function runDiscoveryReport(ctx: Phase1Context): Promise<void> {
    const { project, projectService, channel, cancellationToken: token } = ctx;

    await callWithTelemetryAndErrorHandling('cosmosDB.migration.phase1.discovery', async (context) => {
        setMigrationTelemetryContext(context, project, 'discovery');
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.forceIncludeInReportIssueCommand = true;
        incrementRunCount(project, 'discovery');
        // Check if a discovery report already exists and ask for confirmation
        const discoveryReportPath = path.join(projectService.getDiscoveryPath(), 'discovery-report.md');
        if (await MigrationProjectService.fileExists(vscode.Uri.file(discoveryReportPath))) {
            const rerunItem: vscode.MessageItem = { title: l10n.t('Re-Run') };
            const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('A discovery report already exists. Re-running will overwrite it.'),
                { modal: true },
                rerunItem,
                cancelItem,
            );
            if (overwrite !== rerunItem) return;
        }

        try {
            const model = await getSelectedModel();
            setAiTelemetryContext(context, model);

            ext.outputChannel.appendLog(
                `[Migration] Selected model for discovery: id="${model.id}", name="${model.name}", family="${model.family}", maxInputTokens=${model.maxInputTokens}`,
            );

            await sendPhaseEvent(channel, 'discoveryStarted');

            if (token.isCancellationRequested) return;

            const schemaPath = projectService.getSchemaPath(project);
            const schemaFiles = await projectService.listFiles(schemaPath);

            // Structural metrics
            context.telemetry.measurements.sourceTableCount = schemaFiles.length;
            const appAnalysis = project.phases.discovery.applicationAnalysis;
            if (appAnalysis?.language) {
                context.telemetry.properties.sourceLanguage = appAnalysis.language;
            }
            if (appAnalysis?.frameworks?.length) {
                context.telemetry.properties.sourceFramework = appAnalysis.frameworks.join(', ');
            }
            if (appAnalysis?.databaseType) {
                context.telemetry.properties.sourceDbType = appAnalysis.databaseType;
            }

            if (schemaFiles.length === 0) {
                await sendPhaseEvent(channel, 'discoveryError', ['No schema files found.']);
                return;
            }

            const analysis = project.phases.discovery.applicationAnalysis as AnalysisResult | undefined;

            const accessPatternsPath = projectService.getAccessPatternsPath(project);
            const accessPatternFiles = await projectService.listFiles(accessPatternsPath);
            const volumetricsPath = projectService.getVolumetricsPath(project);
            const volumetricFiles = await projectService.listFiles(volumetricsPath);

            if (USE_CHAT_DISCOVERY) {
                await dispatchChatDiscovery(
                    schemaFiles,
                    volumetricFiles,
                    accessPatternFiles,
                    projectService,
                    project,
                    analysis ?? {},
                );
                await sendPhaseEvent(channel, 'discoveryCompleted');
                return;
            }

            await generateDiscoveryReport(
                model,
                schemaFiles,
                volumetricFiles,
                accessPatternFiles,
                projectService,
                project,
                token,
                analysis ?? {},
                project.phases.discovery.discoveryInstructions,
            );

            await sendPhaseEvent(channel, 'discoveryCompleted');
        } catch (error) {
            if (token.isCancellationRequested) throw new vscode.CancellationError();

            enrichErrorContext(context, error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            ext.outputChannel.error(`[Migration] Discovery report generation failed: ${errorMessage}`);
            await sendPhaseEvent(channel, 'discoveryError', [errorMessage]);
            throw error;
        }
    });
}

/**
 * Returns the workspace-relative path to the volumetrics.md template if it exists on disk.
 */
function getVolumetricsTemplatePath(
    projectService: MigrationProjectService,
    workspacePath: string,
): string | undefined {
    const volFolder = projectService.getDefaultSubfolderPath('volumetrics');
    const absPath = path.join(volFolder, 'volumetrics.md');
    try {
        fs.statSync(absPath);
        return path.relative(workspacePath, absPath);
    } catch {
        return undefined;
    }
}

/**
 * Opens Copilot Chat with a prompt to analyze volumetric data or access patterns.
 * Ensures the template file exists before opening.
 */
export async function runAnalyzeWithAI(
    subfolder: 'volumetrics' | 'access-patterns',
    project: ProjectJson,
    projectService: MigrationProjectService,
): Promise<void> {
    const workspacePath = projectService.getWorkspacePath();

    // Template always lives in the default discovery subfolder
    const templateFolderPath = projectService.getDefaultSubfolderPath(subfolder);
    const fileName = subfolder === 'volumetrics' ? 'volumetrics.md' : 'access-patterns.md';
    const templateAbsPath = path.join(templateFolderPath, fileName);
    const templateUri = vscode.Uri.file(templateAbsPath);

    // Ensure the template file exists
    if (!(await MigrationProjectService.fileExists(templateUri))) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.file(templateFolderPath));
        const content =
            subfolder === 'volumetrics' ? getVolumetricsTemplateContent() : getAccessPatternsTemplateContent();
        await vscode.workspace.fs.writeFile(templateUri, Buffer.from(content, 'utf-8'));
    }

    // Open the template so the user can see AI edits
    await vscode.window.showTextDocument(templateUri, { preview: false });

    // Source files come from the (potentially custom) resolved path
    const sourceFolderPath =
        subfolder === 'volumetrics'
            ? projectService.getVolumetricsPath(project)
            : projectService.getAccessPatternsPath(project);

    // Collect source files, excluding the template if it lives in the same directory
    const allFiles = await projectService.listFiles(sourceFolderPath);
    const nonTemplateFiles =
        sourceFolderPath === templateFolderPath ? allFiles.filter((f) => !f.endsWith(`/${fileName}`)) : allFiles;

    // Volumetrics requires source data files; access patterns can scan the workspace without them
    if (subfolder === 'volumetrics' && nonTemplateFiles.length === 0) {
        void vscode.window.showInformationMessage(
            l10n.t('No source files found to analyze. Select files first, then try again.'),
        );
        return;
    }

    const templateRelativePath = path.relative(workspacePath, templateAbsPath);
    const sourceFolderRelativePath = path.relative(workspacePath, sourceFolderPath);

    // Collect schema file refs for additional context
    const schemaPath = projectService.getSchemaPath(project);
    const schemaFileRefs = path.relative(workspacePath, schemaPath);

    const discoveryInstructions = project.phases.discovery.discoveryInstructions;
    const prompt =
        subfolder === 'volumetrics'
            ? buildAnalyzeVolumetricsPrompt(
                  sourceFolderRelativePath,
                  templateRelativePath,
                  schemaFileRefs,
                  discoveryInstructions,
              )
            : buildAnalyzeAccessPatternsPrompt(
                  nonTemplateFiles.length > 0 ? sourceFolderRelativePath : undefined,
                  templateRelativePath,
                  schemaFileRefs,
                  getVolumetricsTemplatePath(projectService, workspacePath),
                  project.phases.discovery.applicationAnalysis,
                  discoveryInstructions,
              );

    await vscode.commands.executeCommand('workbench.action.chat.open', {
        mode: 'agent',
        query: prompt,
    });
}

/**
 * Cancels an in-progress analysis operation.
 */
export async function cancelAnalysis(
    analysisCancellation: vscode.CancellationTokenSource | undefined,
    channel: Channel,
): Promise<vscode.CancellationTokenSource | undefined> {
    analysisCancellation?.cancel();
    analysisCancellation?.dispose();
    await sendPhaseEvent(channel, 'analysisCancelled');
    return undefined;
}

/**
 * Cancels an in-progress discovery report generation.
 */
export async function cancelDiscovery(
    discoveryCancellation: vscode.CancellationTokenSource | undefined,
    channel: Channel,
): Promise<vscode.CancellationTokenSource | undefined> {
    discoveryCancellation?.cancel();
    discoveryCancellation?.dispose();
    await sendPhaseEvent(channel, 'discoveryCancelled');
    return undefined;
}
