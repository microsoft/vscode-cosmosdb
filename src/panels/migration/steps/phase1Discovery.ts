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
import {
    DEBUG_PROMPTS_ENABLED,
    getSelectedModel,
    logTokenUsage,
    runAgenticLoop,
    runPromptWithJsonResult,
} from '../helpers/aiHelpers';
import { dumpDebugPrompt, tryLoadOverrideMessages } from '../helpers/debugPromptHelpers';
import { resetCancellationToken, sendPhaseEvent } from '../helpers/migrationHelpers';
import { Phase1Step1AnalysisPrompt, Phase1Step2DiscoveryPrompt } from '../prompts';
import { buildFileMap, createToolExecutor, getAllDiscoveryTools } from '../tools/migrationTools';

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
    const exclude = '**/node_modules/**,**/bin/**,**/obj/**,**/dist/**,**/.cosmos-migration/**';

    for (const pattern of allPatterns) {
        const files = await vscode.workspace.findFiles(pattern, exclude, 3);
        for (const file of files) {
            try {
                const content = await vscode.workspace.fs.readFile(file);
                const relativePath = vscode.workspace.asRelativePath(file);
                const text = Buffer.from(content).toString('utf-8').slice(0, 3000);
                context += `\n--- ${relativePath} ---\n${text}\n`;
            } catch {
                // Skip unreadable files
            }
        }
    }

    return context;
}

// ─── Discovery Report Generation ────────────────────────────────────

/**
 * Generates a discovery report using an agentic tool-calling loop.
 * The model is given tools to list and read schema files and user-provided
 * access pattern files on demand, keeping token usage low for large schemas.
 * The result is saved as discovery-report.md in the discovery phase root.
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
): Promise<void> {
    const schemaFileMap = buildFileMap(schemaFiles);
    const volumetricFileMap = buildFileMap(volumetricFiles);
    const accessPatternFileMap = buildFileMap(accessPatternFiles);

    const tools = getAllDiscoveryTools();
    const executeToolCall = createToolExecutor(
        { schemaFileMap, volumetricFileMap, accessPatternFileMap },
        '[Discovery]',
        { language: analysis.language, frameworks: analysis.frameworks },
    );

    const discoveryDir = projectService.getDiscoveryPath();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const outputRelativePath = path.relative(workspaceRoot, path.join(discoveryDir, 'discovery-report.md'));

    const debugDir = path.join(discoveryDir, 'debug-prompts');
    const step2Props = {
        hasAccessPatternFiles: accessPatternFiles.length > 0,
        hasVolumetricFiles: volumetricFiles.length > 0,
        outputRelativePath,
        language: analysis.language ?? '',
        frameworks: analysis.frameworks ?? [],
        databaseAccess: analysis.databaseAccess ?? '',
    };

    let messages: vscode.LanguageModelChatMessage[];

    if (DEBUG_PROMPTS_ENABLED) {
        const override = await tryLoadOverrideMessages(
            debugDir,
            'step2-discovery',
            Phase1Step2DiscoveryPrompt,
            model,
            token,
        );
        if (override) {
            messages = override;
        } else {
            ({ messages } = await (
                await import('@vscode/prompt-tsx')
            ).renderPrompt(
                Phase1Step2DiscoveryPrompt,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                step2Props as any,
                { modelMaxPromptTokens: model.maxInputTokens },
                model,
                undefined,
                token,
            ));
            await dumpDebugPrompt(debugDir, 'step2-discovery', messages, step2Props);
        }
    } else {
        ({ messages } = await (
            await import('@vscode/prompt-tsx')
        ).renderPrompt(
            Phase1Step2DiscoveryPrompt,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            step2Props as any,
            { modelMaxPromptTokens: model.maxInputTokens },
            model,
            undefined,
            token,
        ));
    }

    let allResponseText = '';
    const fullText = await runAgenticLoop(
        model,
        messages,
        tools,
        async (toolCall) => {
            const input = toolCall.input as Record<string, string>;
            const inputArg = input.fileName ?? input.filePath ?? input.pattern ?? '';
            ext.outputChannel.appendLog(`[Discovery] Tool call: ${toolCall.name}(${inputArg})`);
            return executeToolCall(toolCall);
        },
        30,
        token,
        async (round, textChunk, isLastRound) => {
            allResponseText += textChunk;
            if (isLastRound) {
                await logTokenUsage(model, `Discovery (${round + 1} rounds)`, messages, allResponseText);
            } else {
                ext.outputChannel.appendLog(`[Discovery] AI text (round ${round + 1}): ${textChunk.trim()}`);
            }
        },
    );

    if (token.isCancellationRequested || !fullText.trim()) return;

    // Save discovery report
    const outputPath = path.join(discoveryDir, 'discovery-report.md');
    await vscode.workspace.fs.writeFile(vscode.Uri.file(outputPath), Buffer.from(fullText, 'utf-8'));

    await projectService.save(project);
}

// ─── Main Entry Point ───────────────────────────────────────────────

export interface Phase1Context {
    project: ProjectJson;
    projectService: MigrationProjectService;
    channel: Channel;
    analysisCancellation: vscode.CancellationTokenSource | undefined;
}

export interface Phase1Result {
    analysisCancellation: vscode.CancellationTokenSource | undefined;
}

/**
 * Phase 1: Application analysis + discovery report generation.
 * Identifies project type, language, frameworks, DB type, then generates
 * a comprehensive discovery report via agentic AI.
 */
export async function analyzeApplication(ctx: Phase1Context): Promise<Phase1Result> {
    let { analysisCancellation } = ctx;
    const { project, projectService, channel } = ctx;

    await callWithTelemetryAndErrorHandling('migration.ai.analysis', async () => {
        // Check if a discovery report already exists and ask for confirmation
        const discoveryReportPath = path.join(projectService.getDiscoveryPath(), 'discovery-report.md');
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(discoveryReportPath));
            const overwrite = await vscode.window.showWarningMessage(
                l10n.t('A discovery report already exists. Re-analyzing will overwrite it.'),
                { modal: true },
                l10n.t('Re-Analyze'),
            );
            if (overwrite !== l10n.t('Re-Analyze')) return;
        } catch {
            // File doesn't exist — proceed without confirmation
        }

        analysisCancellation = resetCancellationToken(analysisCancellation);
        const token = analysisCancellation.token;

        try {
            const model = await getSelectedModel();

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
            let schemaContext = '';
            for (const file of schemaFiles.slice(0, 10)) {
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
                    const fileName = path.basename(file);
                    schemaContext += `\n--- ${fileName} ---\n${Buffer.from(content).toString('utf-8').slice(0, 5000)}\n`;
                } catch {
                    // Skip unreadable files
                }
            }

            const workspaceContext = await gatherWorkspaceContext();

            const analysis = await runPromptWithJsonResult<AnalysisResult>(
                Phase1Step1AnalysisPrompt,
                { schemaContext, schemaFileTypes, workspaceContext },
                model,
                token,
                'Analysis',
                undefined,
                DEBUG_PROMPTS_ENABLED
                    ? {
                          debugDir: path.join(projectService.getDiscoveryPath(), 'debug-prompts'),
                          stepName: 'step1-analysis',
                      }
                    : undefined,
            );

            // Update project.json
            project.phases.discovery.applicationAnalysis = {
                ...analysis,
                completedAt: new Date().toISOString(),
            };
            project.phases.discovery.status = 'in-progress';
            await projectService.save(project);

            // Generate (or regenerate) the discovery report
            if (schemaFiles.length > 0) {
                const accessPatternsPath = projectService.getAccessPatternsPath(project);
                const accessPatternFiles = await projectService.listFiles(accessPatternsPath);
                const volumetricsPath = projectService.getVolumetricsPath(project);
                const volumetricFiles = await projectService.listFiles(volumetricsPath);
                await generateDiscoveryReport(
                    model,
                    schemaFiles,
                    volumetricFiles,
                    accessPatternFiles,
                    projectService,
                    project,
                    token,
                    analysis,
                );
            }

            await sendPhaseEvent(channel, 'analysisCompleted', [analysis]);
        } catch (error) {
            if (analysisCancellation?.token.isCancellationRequested) return;

            const errorMessage = error instanceof Error ? error.message : String(error);
            await sendPhaseEvent(channel, 'analysisError', [errorMessage]);
        }
    });

    return { analysisCancellation };
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
