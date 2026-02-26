/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling } from '@microsoft/vscode-azext-utils';
import { getTRPCErrorFromUnknown } from '@trpc/server';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { getThemedIconPath, wellKnownEmulatorPassword } from '../constants';
import { AuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { getCosmosClient } from '../cosmosdb/getCosmosClient';
import { ext } from '../extensionVariables';
import { MigrationProjectService, type ProjectJson } from '../services/MigrationProjectService';
import { MigrationWorkspaceItem } from '../tree/workspace-view/migration/MigrationWorkspaceItem';
import { extractStructuralDDL } from '../utils/ddlExtractor';
import { SELECTED_MODEL_KEY } from '../utils/modelUtils';
import { appRouter } from '../webviews/api/configuration/appRouter';
import { createCallerFactory } from '../webviews/api/extension-server/trpc';
import { type VsCodeLinkRequestMessage } from '../webviews/api/webview-client/vscodeLink';
import { BaseTab, type CommandPayload } from './BaseTab';
import { analyzeApplication, cancelAnalysis } from './migration/steps/phase1Discovery';
import { cancelAssessment, runAssessment } from './migration/steps/phase2Assessment';
import { cancelSchemaConversion, runSchemaConversion } from './migration/steps/phase3SchemaConversion';

export class MigrationAssistantTab extends BaseTab {
    public static readonly title = 'Cosmos DB Migration Assistant';
    public static readonly viewType = 'cosmosDbMigration';
    private static instance: MigrationAssistantTab | undefined;

    private projectService: MigrationProjectService;
    private project: ProjectJson | undefined;
    private analysisCancellation: vscode.CancellationTokenSource | undefined;
    private assessmentCancellation: vscode.CancellationTokenSource | undefined;
    private schemaConversionCancellation: vscode.CancellationTokenSource | undefined;

    protected constructor(panel: vscode.WebviewPanel, workspacePath: string) {
        super(panel, MigrationAssistantTab.viewType);

        this.projectService = new MigrationProjectService(workspacePath);

        this.panel.iconPath = getThemedIconPath('editor.svg') as { light: vscode.Uri; dark: vscode.Uri };

        this.setupTrpc();
    }

    /**
     * Set up tRPC message handling alongside Channel communication.
     * tRPC messages have `{ id, op }` format while Channel messages have `{ id, payload }`.
     */
    private setupTrpc(): void {
        this.disposables.push(
            this.panel.webview.onDidReceiveMessage(async (message: unknown) => {
                const msg = message as Record<string, unknown>;
                // Only handle tRPC messages (those with 'op' field, not Channel's 'payload')
                if (!msg || typeof msg !== 'object' || !('op' in msg) || 'payload' in msg) return;

                const trpcMessage = message as unknown as VsCodeLinkRequestMessage;
                try {
                    const callerFactory = createCallerFactory(appRouter);
                    const caller = callerFactory({ dbExperience: 'NoSQL' as never, webviewName: 'migration' });

                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    const procedure = caller[trpcMessage.op.path];
                    if (typeof procedure !== 'function') {
                        throw new Error(l10n.t('Procedure not found: {name}', { name: trpcMessage.op.path }));
                    }

                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
                    const result = await procedure(trpcMessage.op.input);
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                    await this.panel.webview.postMessage({ id: trpcMessage.id, result });
                } catch (error) {
                    const errorEntry = getTRPCErrorFromUnknown(error);
                    await this.panel.webview.postMessage({
                        id: trpcMessage.id,
                        error: {
                            code: errorEntry.code,
                            name: errorEntry.name,
                            message: errorEntry.message,
                        },
                    });
                }
            }),
        );
    }

    public static render(workspacePath: string, viewColumn = vscode.ViewColumn.Active): MigrationAssistantTab {
        if (MigrationAssistantTab.instance) {
            MigrationAssistantTab.instance.panel.reveal(viewColumn);
            return MigrationAssistantTab.instance;
        }

        const panel = vscode.window.createWebviewPanel(
            MigrationAssistantTab.viewType,
            MigrationAssistantTab.title,
            viewColumn,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            },
        );

        const tab = new MigrationAssistantTab(panel, workspacePath);
        MigrationAssistantTab.instance = tab;
        return tab;
    }

    public dispose(): void {
        MigrationAssistantTab.instance = undefined;
        this.analysisCancellation?.cancel();
        this.analysisCancellation?.dispose();
        this.assessmentCancellation?.cancel();
        this.assessmentCancellation?.dispose();
        this.schemaConversionCancellation?.cancel();
        this.schemaConversionCancellation?.dispose();
        super.dispose();
    }

    /**
     * On activation, check for existing migration projects and prompt to re-open.
     */
    public static async promptToReopen(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;

        const workspacePath = workspaceFolders[0].uri.fsPath;
        const detected = await MigrationProjectService.detectInWorkspace(workspacePath);
        if (!detected) return;

        const open = await vscode.window.showInformationMessage(
            l10n.t(
                'An existing Cosmos DB migration project was detected. Would you like to re-open the Migration Assistant?',
            ),
            l10n.t('Open'),
            l10n.t('Dismiss'),
        );

        if (open === l10n.t('Open')) {
            MigrationAssistantTab.render(workspacePath);
        }
    }

    /**
     * Notify all instances about AI feature availability changes.
     */
    public static async notifyAIFeaturesChanged(available: boolean): Promise<void> {
        if (MigrationAssistantTab.instance) {
            await MigrationAssistantTab.instance.channel.postMessage({
                type: 'event',
                name: 'aiFeaturesEnabledChanged',
                params: [available],
            });

            // Refresh available models when AI features become available,
            // since the initial fetch may have returned empty if Copilot wasn't ready.
            if (available) {
                await MigrationAssistantTab.instance.getAvailableModels();
            }
        }
    }

    protected async getCommand(payload: CommandPayload): Promise<void> {
        switch (payload.commandName) {
            case 'loadProject':
                return this.loadProject();
            case 'updateProjectName':
                return this.updateProjectName(payload.params[0] as string);
            case 'selectSchemaFiles':
                return this.selectFiles('schema-ddl');
            case 'selectSchemaFolder':
                return this.selectFolder('schema-ddl');
            case 'selectVolumetricFiles':
                return this.selectFiles('volumetrics');
            case 'selectVolumetricFolder':
                return this.selectFolder('volumetrics');
            case 'selectAccessPatternFiles':
                return this.selectFiles('access-patterns');
            case 'selectAccessPatternFolder':
                return this.selectFolder('access-patterns');
            case 'analyzeApplication':
                return this.analyzeApplication();
            case 'updateAnalysisResult':
                return this.updateAnalysisResult(payload.params[0] as Record<string, string>);
            case 'cancelAnalysis':
                return this.cancelAnalysis();
            case 'runAssessment':
                return this.runAssessment();
            case 'cancelAssessment':
                return this.cancelAssessment();
            case 'runSchemaConversion':
                return this.runSchemaConversion(payload.params[0] as boolean | undefined);
            case 'cancelSchemaConversion':
                return this.cancelSchemaConversion();
            case 'setTargetEnvironment':
                return this.setTargetEnvironment(
                    payload.params[0] as 'emulator' | 'azure',
                    payload.params[1] as string | undefined,
                );
            case 'testConnection':
                return this.testConnection();
            case 'resetProject':
                return this.resetProject();
            case 'getAvailableModels':
                return this.getAvailableModels();
            case 'setSelectedModel':
                return this.setSelectedModel(payload.params[0] as string);
            case 'estimateContextTokens':
                return this.estimateContextTokens();
            case 'checkGitRepository':
                return this.checkGitRepository();
            case 'initGitRepository':
                return this.initGitRepository();
            case 'openFile':
                return this.openFile(payload.params[0] as string);
            case 'previewMarkdown':
                return this.previewMarkdown(payload.params[0] as string);
            default:
                return super.getCommand(payload);
        }
    }

    private async loadProject(): Promise<void> {
        await callWithTelemetryAndErrorHandling('migration.loadProject', async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            const workspacePath = workspaceFolders?.[0]?.uri.fsPath ?? '';

            this.project = await this.projectService.load();

            if (!this.project) {
                // Initialize new project
                const folderName = path.basename(workspacePath);
                this.project = await this.projectService.initialize(folderName);

                // Add to workspace tree
                await MigrationWorkspaceItem.addMigration(folderName, workspacePath);
                ext.migrationWorkspaceBranchDataProvider?.refresh();
            }

            // Gather file lists
            const schemaFiles = await this.projectService.listFiles(this.projectService.getSchemaPath(this.project));
            const volumetricFiles = await this.projectService.listFiles(
                this.projectService.getVolumetricsPath(this.project),
            );
            const accessPatternFiles = await this.projectService.listFiles(
                this.projectService.getAccessPatternsPath(this.project),
            );

            // Check if discovery-report.md exists on disk
            const discoveryReportPath = path.join(this.projectService.getDiscoveryPath(), 'discovery-report.md');
            let hasDiscoveryReport = false;
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(discoveryReportPath));
                hasDiscoveryReport = true;
            } catch {
                // File does not exist
            }

            // Check if assessment-summary.md exists on disk
            const assessmentSummaryPath = path.join(this.projectService.getAssessmentPath(), 'assessment-summary.md');
            let hasAssessmentSummary = false;
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(assessmentSummaryPath));
                hasAssessmentSummary = true;
            } catch {
                // File does not exist
            }

            // Reconstruct assessment result from persisted data
            let assessmentResult: {
                domainFiles: {
                    name: string;
                    tables: string[];
                    filePath: string;
                    isMapped: boolean;
                    estimatedTokens: number;
                }[];
                summaryFilePath: string;
            } | null = null;
            if (hasAssessmentSummary && this.project.phases.assessment?.domains) {
                const assessmentPath = this.projectService.getAssessmentPath();
                assessmentResult = {
                    domainFiles: this.project.phases.assessment.domains.map((d) => ({
                        name: d.name,
                        tables: d.tables,
                        filePath: path.join(assessmentPath, 'domains', `${d.name}.md`),
                        isMapped: d.isMapped,
                        estimatedTokens: d.estimatedTokens,
                    })),
                    summaryFilePath: assessmentSummaryPath,
                };
            }

            // Check if schema conversion domains exist on disk
            const schemaConversionDomainsPath = path.join(this.projectService.getSchemaConversionPath(), 'domains');
            let hasSchemaConversion = false;
            try {
                const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(schemaConversionDomainsPath));
                hasSchemaConversion = entries.some(([, type]) => type === vscode.FileType.Directory);
            } catch {
                // Folder does not exist
            }

            await this.channel.postMessage({
                type: 'event',
                name: 'projectLoaded',
                params: [
                    {
                        project: this.project,
                        workspacePath,
                        schemaFiles,
                        volumetricFiles,
                        accessPatternFiles,
                        hasDiscoveryReport,
                        hasAssessmentSummary,
                        assessmentResult,
                        hasSchemaConversion,
                        isAIFeaturesEnabled: ext.isAIFeaturesEnabled,
                    },
                ],
            });
        });
    }

    private async updateProjectName(name: string): Promise<void> {
        if (!this.project) return;
        this.project.name = name;
        await this.projectService.save(this.project);
    }

    private async selectFiles(subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns'): Promise<void> {
        const filterMap: Record<string, Record<string, string[]>> = {
            'schema-ddl': { 'Schema Files': ['sql', 'json', 'xml', 'csv', 'log', 'out'] },
            volumetrics: { 'Volumetric Files': ['txt', 'csv', 'json', 'html', 'xls', 'xlsx'] },
            'access-patterns': { 'Access Pattern Files': ['md', 'txt'] },
        };

        const fileUris = await vscode.window.showOpenDialog({
            canSelectMany: true,
            canSelectFiles: true,
            canSelectFolders: false,
            openLabel: l10n.t('Select Files'),
            filters: filterMap[subfolder],
        });

        if (!fileUris || fileUris.length === 0 || !this.project) return;

        await this.handleFileSelection(fileUris, subfolder);
    }

    private async selectFolder(subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns'): Promise<void> {
        const folderUris = await vscode.window.showOpenDialog({
            canSelectMany: false,
            canSelectFiles: false,
            canSelectFolders: true,
            openLabel: l10n.t('Select Folder'),
        });

        if (!folderUris || folderUris.length === 0 || !this.project) return;

        await this.handleFolderSelection(folderUris[0], subfolder);
    }

    private async handleFileSelection(
        fileUris: vscode.Uri[],
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
    ): Promise<void> {
        if (!this.project) return;

        const outsideWorkspace = fileUris.some((uri) => !this.projectService.isInsideWorkspace(uri.fsPath));

        if (outsideWorkspace) {
            const copy = await vscode.window.showInformationMessage(
                l10n.t(
                    'Some selected files are outside the workspace. Would you like to copy them to the migration project?',
                ),
                { modal: true },
                l10n.t('Copy'),
            );
            if (!copy) return;
        }

        await this.projectService.copyFilesToSubfolder(fileUris, subfolder);
        await this.projectService.save(this.project);
        await this.loadProject();
    }

    private async handleFolderSelection(
        folderUri: vscode.Uri,
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
    ): Promise<void> {
        if (!this.project) return;

        const isInWorkspace = this.projectService.isInsideWorkspace(folderUri.fsPath);

        if (isInWorkspace) {
            // Save relative path reference in project.json
            const relativePath = this.projectService.getRelativePath(folderUri.fsPath);
            this.updateProjectPath(subfolder, relativePath);
        } else {
            const copy = await vscode.window.showInformationMessage(
                l10n.t(
                    'The selected folder is outside the workspace. Would you like to copy its contents to the migration project?',
                ),
                { modal: true },
                l10n.t('Copy'),
            );
            if (!copy) return;

            // Read all files from the folder and copy them
            const entries = await vscode.workspace.fs.readDirectory(folderUri);
            const fileUris = entries
                .filter(([, type]) => type === vscode.FileType.File)
                .map(([name]) => vscode.Uri.file(path.join(folderUri.fsPath, name)));

            await this.projectService.copyFilesToSubfolder(fileUris, subfolder);
        }

        await this.projectService.save(this.project);
        await this.loadProject();
    }

    private updateProjectPath(subfolder: string, relativePath: string): void {
        if (!this.project) return;

        const discovery = this.project.phases.discovery;
        switch (subfolder) {
            case 'schema-ddl':
                discovery.schemaInventory = { path: relativePath };
                break;
            case 'volumetrics':
                discovery.volumetrics = { path: relativePath };
                break;
            case 'access-patterns':
                discovery.accessPatterns = { path: relativePath };
                break;
        }
    }

    private async analyzeApplication(): Promise<void> {
        if (!this.project) return;
        const result = await analyzeApplication({
            project: this.project,
            projectService: this.projectService,
            channel: this.channel,
            analysisCancellation: this.analysisCancellation,
        });
        this.analysisCancellation = result.analysisCancellation;
    }

    private async updateAnalysisResult(updates: Record<string, string>): Promise<void> {
        if (!this.project) return;

        const existing = this.project.phases.discovery.applicationAnalysis ?? {};
        const field = Object.keys(updates)[0];
        const value = updates[field];

        if (field === 'frameworks') {
            existing.frameworks = value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
        } else {
            (existing as Record<string, unknown>)[field] = value;
        }

        this.project.phases.discovery.applicationAnalysis = existing;
        await this.projectService.save(this.project);
    }

    private async cancelAnalysis(): Promise<void> {
        this.analysisCancellation = await cancelAnalysis(this.analysisCancellation, this.channel);
    }

    private async runAssessment(): Promise<void> {
        if (!this.project) return;
        const result = await runAssessment({
            project: this.project,
            projectService: this.projectService,
            channel: this.channel,
            assessmentCancellation: this.assessmentCancellation,
        });
        this.assessmentCancellation = result.assessmentCancellation;
    }

    private async cancelAssessment(): Promise<void> {
        this.assessmentCancellation = await cancelAssessment(this.assessmentCancellation, this.channel);
    }

    private async runSchemaConversion(includeUnmappedDomains?: boolean): Promise<void> {
        if (!this.project) return;
        const result = await runSchemaConversion(
            {
                project: this.project,
                projectService: this.projectService,
                channel: this.channel,
                schemaConversionCancellation: this.schemaConversionCancellation,
            },
            includeUnmappedDomains,
        );
        this.schemaConversionCancellation = result.schemaConversionCancellation;
    }

    private async cancelSchemaConversion(): Promise<void> {
        this.schemaConversionCancellation = await cancelSchemaConversion(
            this.schemaConversionCancellation,
            this.channel,
        );
    }

    private async setTargetEnvironment(type: 'emulator' | 'azure', connectionString?: string): Promise<void> {
        if (!this.project) return;

        this.project.phases.discovery.targetEnvironment = {
            type,
            connectionString,
            verified: false,
        };
        await this.projectService.save(this.project);
    }

    private async testConnection(): Promise<void> {
        await callWithTelemetryAndErrorHandling('migration.connection.tested', async () => {
            if (!this.project?.phases.discovery.targetEnvironment) return;

            const target = this.project.phases.discovery.targetEnvironment;

            await this.channel.postMessage({
                type: 'event',
                name: 'connectionTestStarted',
                params: [],
            });

            try {
                let endpoint: string;
                const isEmulator = target.type === 'emulator';

                if (isEmulator) {
                    const emulatorPort =
                        vscode.workspace.getConfiguration('cosmosDB').get<number>('emulator.port') ?? 8081;
                    endpoint = `https://localhost:${emulatorPort}`;
                } else {
                    endpoint = target.connectionString ?? '';
                    if (!endpoint) {
                        throw new Error(l10n.t('No endpoint provided.'));
                    }
                }

                const credentials = isEmulator
                    ? [{ type: AuthenticationMethod.accountKey as const, key: wellKnownEmulatorPassword }]
                    : [{ type: AuthenticationMethod.entraId as const, tenantId: undefined }];

                const client = getCosmosClient(endpoint, credentials, isEmulator);

                // Test with a simple database list call
                await client.databases.readAll().fetchAll();

                target.verified = true;
                target.verifiedAt = new Date().toISOString();
                await this.projectService.save(this.project);

                await this.channel.postMessage({
                    type: 'event',
                    name: 'connectionTestResult',
                    params: [{ success: true }],
                });
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                await this.channel.postMessage({
                    type: 'event',
                    name: 'connectionTestResult',
                    params: [{ success: false, error: errorMessage }],
                });
            }
        });
    }

    private async resetProject(): Promise<void> {
        if (!this.project) return;

        const confirm = await vscode.window.showWarningMessage(
            l10n.t('Are you sure you want to reset this migration? All progress will be lost.'),
            { modal: true },
            l10n.t('Reset'),
        );

        if (confirm !== l10n.t('Reset')) return;

        this.project = await this.projectService.reset(this.project);
        await this.loadProject();
    }

    private async getAvailableModels(): Promise<void> {
        try {
            const allModels = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);

            // Filter out the "Auto" virtual model — it doesn't support countTokens or sendRequest
            const models = allModels.filter((m) => m.id !== 'auto');

            const modelList = models.map((m) => ({
                id: m.id,
                name: m.name,
                family: m.family,
                vendor: m.vendor,
                maxInputTokens: m.maxInputTokens,
            }));

            await this.channel.postMessage({
                type: 'event',
                name: 'availableModels',
                params: [modelList, savedModelId],
            });
        } catch {
            await this.channel.postMessage({
                type: 'event',
                name: 'availableModels',
                params: [[], null],
            });
        }
    }

    private async setSelectedModel(modelId: string): Promise<void> {
        await ext.context.globalState.update(SELECTED_MODEL_KEY, modelId);
    }

    /**
     * Estimates the token count for the current schema + access pattern context
     * using the selected model's tokenizer.
     */
    private async estimateContextTokens(): Promise<void> {
        try {
            if (!this.project) return;

            const models = await vscode.lm.selectChatModels({ vendor: 'copilot' });
            if (models.length === 0) return;

            const savedModelId = ext.context.globalState.get<string>(SELECTED_MODEL_KEY);
            const model = savedModelId ? (models.find((m) => m.id === savedModelId) ?? models[0]) : models[0];

            ext.outputChannel.appendLog(`[Migration] estimateContextTokens: model="${model.name}" (${model.id})`);

            // Read schema files with the same transformations used during analysis
            const schemaPath = this.projectService.getSchemaPath(this.project);
            const schemaFiles = await this.projectService.listFiles(schemaPath);
            let contextText = '';

            for (const file of schemaFiles) {
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
                    const rawText = Buffer.from(content).toString('utf-8');
                    const fileExt = path.extname(file).toLowerCase();
                    let processed = rawText;
                    if (fileExt === '.sql') processed = extractStructuralDDL(rawText);
                    else if (fileExt === '.csv') processed = rawText.split('\n').slice(0, 2).join('\n');
                    contextText += `\n--- ${path.basename(file)} ---\n${processed}\n`;
                } catch {
                    // Skip unreadable files
                }
            }

            // Read access pattern files
            const accessPatternsPath = this.projectService.getAccessPatternsPath(this.project);
            const accessPatternFiles = await this.projectService.listFiles(accessPatternsPath);

            for (const file of accessPatternFiles) {
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
                    contextText += `\n--- ${path.basename(file)} ---\n${Buffer.from(content).toString('utf-8')}\n`;
                } catch {
                    // Skip unreadable files
                }
            }

            // Read volumetric files
            const volumetricsPath = this.projectService.getVolumetricsPath(this.project);
            const volumetricFiles = await this.projectService.listFiles(volumetricsPath);

            for (const file of volumetricFiles) {
                try {
                    const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
                    contextText += `\n--- ${path.basename(file)} ---\n${Buffer.from(content).toString('utf-8')}\n`;
                } catch {
                    // Skip unreadable files
                }
            }

            if (!contextText) {
                await this.channel.postMessage({
                    type: 'event',
                    name: 'tokenEstimate',
                    params: [null],
                });
                return;
            }

            const message = vscode.LanguageModelChatMessage.User(contextText);
            const tokenCount = await model.countTokens(message);

            await this.channel.postMessage({
                type: 'event',
                name: 'tokenEstimate',
                params: [{ tokens: tokenCount, maxTokens: model.maxInputTokens }],
            });
        } catch (error) {
            ext.outputChannel.appendLog(
                `[Migration] estimateContextTokens error: ${error instanceof Error ? error.message : String(error)}`,
            );
            await this.channel.postMessage({
                type: 'event',
                name: 'tokenEstimate',
                params: [null],
            });
        }
    }

    private async openFile(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri, { preview: true });
    }

    private async previewMarkdown(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
    }

    private async checkGitRepository(): Promise<void> {
        const hasGit = await this.hasGitRepository();
        await this.channel.postMessage({
            type: 'event',
            name: 'gitStatus',
            params: [hasGit],
        });
    }

    /**
     * Check for a git repository using the built-in git extension API,
     * falling back to .git folder detection.
     */
    private async hasGitRepository(): Promise<boolean> {
        try {
            const gitExtension = vscode.extensions.getExtension<{ getAPI(version: 1): { repositories: unknown[] } }>(
                'vscode.git',
            );
            if (gitExtension) {
                const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
                const api = git.getAPI(1);
                return api.repositories.length > 0;
            }
        } catch {
            // Fall back to filesystem check
        }
        return this.projectService.hasGitRepository();
    }

    private async initGitRepository(): Promise<void> {
        try {
            const gitExtension = vscode.extensions.getExtension<{
                getAPI(version: 1): { init(root: vscode.Uri): Promise<unknown> };
            }>('vscode.git');
            if (gitExtension) {
                const git = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
                const api = git.getAPI(1);
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders && workspaceFolders.length > 0) {
                    await api.init(workspaceFolders[0].uri);
                    await this.checkGitRepository();
                    return;
                }
            }
        } catch {
            // Fall back to terminal
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;

        const terminal = vscode.window.createTerminal({ name: 'Git Init', cwd: workspaceFolders[0].uri.fsPath });
        terminal.sendText('git init');
        terminal.show();

        // Re-check after a delay
        setTimeout(() => void this.checkGitRepository(), 3000);
    }
}
