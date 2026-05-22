/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSCodeAzureSubscriptionProvider } from '@microsoft/vscode-azext-azureauth';
import {
    LocationListStep,
    ResourceGroupCreateStep,
    ResourceGroupListStep,
    type IResourceGroupWizardContext,
} from '@microsoft/vscode-azext-azureutils';
import {
    AzureWizard,
    callWithTelemetryAndErrorHandling,
    createSubscriptionContext,
    subscriptionExperience,
    type AzureWizardPromptStep,
} from '@microsoft/vscode-azext-utils';
import { AzExtResourceType, type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as path from 'path';
import * as vscode from 'vscode';
import { getThemedIconPath } from '../constants';
import { getCosmosDBEntraIdCredential } from '../cosmosdb/CosmosDBCredential';
import { ext } from '../extensionVariables';
import { MIGRATION_FOLDER, MigrationProjectService, type ProjectJson } from '../services/MigrationProjectService';
import { getAccountInfo } from '../tree/cosmosdb/AccountInfo';
import { type CosmosDBAccountAttachedResourceItem } from '../tree/cosmosdb/CosmosDBAccountAttachedResourceItem';
import { type CosmosDBAccountResourceItem } from '../tree/cosmosdb/CosmosDBAccountResourceItem';
import { WorkspaceResourceType } from '../tree/workspace-api/SharedWorkspaceResourceProvider';
import { MigrationWorkspaceItem } from '../tree/workspace-view/migration/MigrationWorkspaceItem';
import { getAvailableModelsInfo } from '../utils/aiUtils';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { sanitizeCosmosDBAccountName } from '../utils/cosmosDBAccountName';
import { MIGRATION_SELECTED_MODEL_KEY } from '../utils/modelUtils';
import { pickAppResource, pickWorkspaceResource } from '../utils/pickItem/pickAppResource';
import { TypedEventSink } from '../utils/TypedEventSink';
import { BaseTab } from './BaseTab';
import { getSelectedModel, IS_PHASE4_REQUIRED, isDebugPromptsEnabled } from './migration/helpers/aiHelpers';
import { emitMigrationEvent, resetCancellationToken } from './migration/helpers/migrationHelpers';
import { setMigrationTelemetryContext } from './migration/helpers/migrationTelemetry';
import { buildCodeMigrationPrompt } from './migration/prompts';
import {
    cancelAnalysis,
    cancelDiscovery,
    estimateDiscoveryTokens,
    runAnalyzeDatabaseSchema,
    runAnalyzeWithAI,
    runApplicationAnalysis,
    runDiscoveryReport,
} from './migration/steps/phase1Discovery';
import { cancelAssessment, runAssessment } from './migration/steps/phase2Assessment';
import { cancelSchemaConversion, runSchemaConversion } from './migration/steps/phase3SchemaConversion';
import {
    cancelAccountProvisioning,
    cancelProvisioning,
    populateSampleData,
    provisionAccount,
    refineBicepParams,
    testConnection,
} from './migration/steps/phase4Provisioning';
import { getAccessPatternsTemplateContent } from './migration/templates/accessPatternsTemplate';
import { getVolumetricsTemplateContent } from './migration/templates/volumetricsTemplate';
import { migrationAppRouter, migrationCallerFactory, type MigrationRouterContext } from './trpc/appRouter';
import { type MigrationEvent } from './trpc/routers/migrationEventsRouter';
import { setupTrpc } from './trpc/setupTrpc';

export class MigrationAssistantTab extends BaseTab {
    public static readonly title = 'Cosmos DB Migration Assistant';
    public static readonly viewType = 'cosmosDbMigration';
    /**
     * One panel per workspace folder, keyed by the normalized folder path. A global
     * singleton would silently re-reveal the first-opened panel when a migration is
     * launched from a different workspace folder.
     */
    private static readonly instances = new Map<string, MigrationAssistantTab>();

    private readonly workspacePath: string;
    private readonly workspaceKey: string;
    private projectService: MigrationProjectService;
    private project: ProjectJson | undefined;
    private analysisCancellation: vscode.CancellationTokenSource | undefined;
    private discoveryCancellation: vscode.CancellationTokenSource | undefined;
    private assessmentCancellation: vscode.CancellationTokenSource | undefined;
    private schemaConversionCancellation: vscode.CancellationTokenSource | undefined;
    private provisioningCancellation: vscode.CancellationTokenSource | undefined;
    private accountProvisioningCancellation: vscode.CancellationTokenSource | undefined;
    private selectedSubscription: AzureSubscription | undefined;
    private fileWatchers: vscode.Disposable[] = [];
    private fileWatcherDebounceTimer: ReturnType<typeof setTimeout> | undefined;
    private fileStateGeneration = 0;

    private readonly eventSink: TypedEventSink<MigrationEvent>;

    protected constructor(panel: vscode.WebviewPanel, workspacePath: string) {
        super(panel, MigrationAssistantTab.viewType);

        this.workspacePath = path.resolve(workspacePath);
        this.workspaceKey = MigrationAssistantTab.normalizeKey(this.workspacePath);
        this.projectService = new MigrationProjectService(this.workspacePath);

        this.panel.iconPath = getThemedIconPath('editor.svg') as { light: vscode.Uri; dark: vscode.Uri };

        this.eventSink = new TypedEventSink<MigrationEvent>();

        const { disposable } = setupTrpc(
            this.panel,
            this.buildRouterContext(),
            migrationAppRouter,
            migrationCallerFactory,
        );
        this.disposables.push(disposable);

        // Forward changes to the experimental "show token estimate" setting to the webview
        // so the UI can show/hide the progress bar live without a panel reload. The estimate
        // itself is always calculated and logged regardless of this setting.
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('cosmosDB.experimental.migration.showTokenEstimate')) {
                    emitMigrationEvent(this.eventSink, 'showTokenEstimateChanged', [
                        MigrationAssistantTab.getShowTokenEstimateSetting(),
                    ]);
                }
            }),
        );
    }

    /**
     * Read the experimental setting controlling whether the Discovery token-estimate
     * progress bar is rendered in the webview. Calculation/logging are independent.
     */
    private static getShowTokenEstimateSetting(): boolean {
        return (
            vscode.workspace
                .getConfiguration('cosmosDB')
                .get<boolean>('experimental.migration.showTokenEstimate', false) ?? false
        );
    }

    /**
     * Normalize a workspace path for use as an instance map key. Case-insensitive
     * on Windows to match filesystem semantics; case-sensitive elsewhere.
     */
    private static normalizeKey(workspacePath: string): string {
        const resolved = path.resolve(workspacePath);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }

    /**
     * Build the router context handed to every migration tRPC procedure.
     * Includes the event sink (for the `events` subscription) and a command
     * dispatcher that fans out to the per-command handlers via dispatchCommand.
     */
    private buildRouterContext(): MigrationRouterContext {
        return {
            webviewName: 'migration',
            telemetryContext: this.telemetryContext,
            panel: this.panel,
            eventSink: this.eventSink,
            dispatchCommand: (commandName, params) => this.dispatchCommand(commandName, params),
        };
    }

    public static render(workspacePath: string, viewColumn = vscode.ViewColumn.Active): MigrationAssistantTab {
        const key = MigrationAssistantTab.normalizeKey(workspacePath);
        const existing = MigrationAssistantTab.instances.get(key);
        if (existing) {
            existing.panel.reveal(viewColumn);
            return existing;
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
        MigrationAssistantTab.instances.set(tab.workspaceKey, tab);
        return tab;
    }

    public dispose(): void {
        MigrationAssistantTab.instances.delete(this.workspaceKey);
        this.disposeFileWatchers();
        this.analysisCancellation?.cancel();
        this.analysisCancellation?.dispose();
        this.discoveryCancellation?.cancel();
        this.discoveryCancellation?.dispose();
        this.assessmentCancellation?.cancel();
        this.assessmentCancellation?.dispose();
        this.schemaConversionCancellation?.cancel();
        this.schemaConversionCancellation?.dispose();
        this.provisioningCancellation?.cancel();
        this.provisioningCancellation?.dispose();
        this.accountProvisioningCancellation?.cancel();
        this.accountProvisioningCancellation?.dispose();
        this.eventSink.close();
        super.dispose();
    }

    /**
     * On activation, check each workspace folder for an existing migration project
     * and show an independent non-modal notification per folder that has one.
     */
    public static async promptToReopen(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) return;

        const detections = await Promise.all(
            workspaceFolders.map(async (folder) => ({
                folder,
                detected: await MigrationProjectService.detectInWorkspace(folder.uri.fsPath),
            })),
        );

        for (const { folder, detected } of detections) {
            if (!detected) continue;
            void (async () => {
                const openItem: vscode.MessageItem = { title: l10n.t('Open') };
                const dismissItem: vscode.MessageItem = { title: l10n.t('Dismiss'), isCloseAffordance: true };
                const selected = await vscode.window.showInformationMessage(
                    l10n.t(
                        "An existing Cosmos DB migration project was detected in '{folder}'. Would you like to re-open the Migration Assistant?",
                        { folder: folder.name },
                    ),
                    openItem,
                    dismissItem,
                );
                if (selected === openItem) {
                    MigrationAssistantTab.render(folder.uri.fsPath);
                }
            })();
        }
    }

    /**
     * Notify all instances about AI feature availability changes.
     */
    public static async notifyAIFeaturesChanged(available: boolean): Promise<void> {
        for (const instance of MigrationAssistantTab.instances.values()) {
            emitMigrationEvent(instance.eventSink, 'aiFeaturesEnabledChanged', [available]);

            // Refresh available models when AI features become available,
            // since the initial fetch may have returned empty if Copilot wasn't ready.
            if (available) {
                await instance.getAvailableModels();
            }
        }
    }

    private async dispatchCommand(commandName: string, params: unknown[]): Promise<unknown> {
        switch (commandName) {
            case 'loadProject':
                return this.loadProject();
            case 'updateProjectName':
                return this.updateProjectName(params[0] as string);
            case 'updateConsent':
                return this.updateConsent(params[0] as boolean);
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
            case 'removeDiscoveryFile':
                return this.removeDiscoveryFile(
                    params[0] as 'schema-ddl' | 'volumetrics' | 'access-patterns',
                    params[1] as string,
                );
            case 'restoreDiscoveryFile':
                return this.restoreDiscoveryFile(
                    params[0] as 'schema-ddl' | 'volumetrics' | 'access-patterns',
                    params[1] as string,
                );
            case 'createVolumetricTemplate':
                return this.createTemplate('volumetrics');
            case 'createAccessPatternTemplate':
                return this.createTemplate('access-patterns');
            case 'openVolumetricsTemplate':
                return this.openTemplate('volumetrics');
            case 'openAccessPatternsTemplate':
                return this.openTemplate('access-patterns');
            case 'analyzeVolumetrics':
                return this.analyzeWithAI('volumetrics');
            case 'analyzeAccessPatterns':
                return this.analyzeWithAI('access-patterns');
            case 'analyzeDatabaseSchema':
                return this.analyzeDatabaseSchema();
            case 'analyzeApplication':
                return this.analyzeApplication();
            case 'updateAnalysisResult':
                return this.updateAnalysisResult(params[0] as Record<string, unknown>);
            case 'cancelAnalysis':
                return this.cancelAnalysis();
            case 'runDiscovery':
                return this.runDiscovery();
            case 'updateDiscoveryInstructions':
                return this.updateDiscoveryInstructions(params[0] as string);
            case 'updateAssessmentInstructions':
                return this.updateAssessmentInstructions(params[0] as string);
            case 'updateSchemaConversionInstructions':
                return this.updateSchemaConversionInstructions(params[0] as string);
            case 'cancelDiscovery':
                return this.cancelDiscovery();
            case 'runAssessment':
                return this.runAssessment();
            case 'cancelAssessment':
                return this.cancelAssessment();
            case 'runSchemaConversion':
                return this.runSchemaConversion(params[0] as boolean | undefined, params[1] as boolean | undefined);
            case 'cancelSchemaConversion':
                return this.cancelSchemaConversion();
            case 'setTargetEnvironment':
                return this.setTargetEnvironment(
                    params[0] as 'emulator' | 'azure' | 'provision',
                    params[1] as string | undefined,
                    params[2] as string | undefined,
                    params[3] as string | undefined,
                    params[4] as string | undefined,
                );
            case 'selectAccount':
                return this.selectAccount();
            case 'selectResourceGroup':
                return this.selectResourceGroup();
            case 'listCosmosDBLocations':
                return this.listCosmosDBLocations();
            case 'setTargetLocation':
                return this.setTargetLocation(params[0] as string);
            case 'testConnection':
                return this.testConnection();
            case 'provisionAccount':
                return this.provisionNewAccount();
            case 'populateSampleData':
                return this.populateSampleData();
            case 'cancelProvisioning':
                return this.cancelProvisioning();
            case 'cancelAccountProvisioning':
                return this.cancelAccountProvisioning();
            case 'resetProject':
                return this.resetProject();
            case 'getAvailableModels':
                return this.getAvailableModels();
            case 'setSelectedModel':
                return this.setSelectedModel(params[0] as string);
            case 'estimateContextTokens':
                return this.estimateContextTokens();
            case 'checkGitRepository':
                return this.checkGitRepository();
            case 'initGitRepository':
                return this.initGitRepository();
            case 'addToGitignore':
                return this.addToGitignore();
            case 'removeFromGitignore':
                return this.removeFromGitignore();
            case 'checkGitignore':
                return this.checkGitignore();
            case 'openFile':
                return this.openFile(params[0] as string);
            case 'revealInExplorer':
                return this.revealInExplorer(params[0] as string);
            case 'openGeneratedBicep':
                return this.openGeneratedBicep();
            case 'previewMarkdown':
                return this.previewMarkdown(params[0] as string);
            case 'updateMigrationInstructions':
                return this.updateMigrationInstructions(params[0] as string);
            case 'setMigrationMode':
                return this.setMigrationMode(params[0] as 'plan' | 'start');
            case 'planMigration':
                return this.executeMigration('plan');
            case 'startMigration':
                return this.executeMigration('start');
            default:
                throw new Error(l10n.t('Unknown migration command: {name}', { name: commandName }));
        }
    }

    private async loadProject(): Promise<void> {
        await callWithTelemetryAndErrorHandling('cosmosDB.migration.loadProject', async (context) => {
            this.project = await this.projectService.load();
            const isNewProject = !this.project;

            if (!this.project) {
                // Create an in-memory project; the folder is only created on the first change
                const folderName = path.basename(this.workspacePath);
                this.project = this.projectService.createDefaultProject(folderName);
            }

            setMigrationTelemetryContext(context, this.project);
            context.telemetry.properties.isNewProject = String(isNewProject);

            // Gather file lists. Hide the curated template files from the UI —
            // they are managed via the dedicated "Open Template" buttons and AI flows,
            // not the user-selectable source list.
            const volTemplateAbs = this.projectService.getTemplateFilePath('volumetrics');
            const apTemplateAbs = this.projectService.getTemplateFilePath('access-patterns');
            const schemaFiles = await this.projectService.listDiscoveryFiles(this.project, 'schema-ddl');
            const volumetricFiles = (await this.projectService.listDiscoveryFiles(this.project, 'volumetrics')).filter(
                (f) => f !== volTemplateAbs,
            );
            const accessPatternFiles = (
                await this.projectService.listDiscoveryFiles(this.project, 'access-patterns')
            ).filter((f) => f !== apTemplateAbs);
            const excludedSchemaFiles = await this.projectService.listExcludedDiscoveryFiles(
                this.project,
                'schema-ddl',
            );
            const excludedVolumetricFiles = await this.projectService.listExcludedDiscoveryFiles(
                this.project,
                'volumetrics',
            );
            const excludedAccessPatternFiles = await this.projectService.listExcludedDiscoveryFiles(
                this.project,
                'access-patterns',
            );

            // Check if discovery-report.md exists on disk
            const discoveryReportPath = path.join(this.projectService.getDiscoveryPath(), 'discovery-report.md');
            const hasDiscoveryReport = await MigrationProjectService.fileExists(vscode.Uri.file(discoveryReportPath));

            // Check if assessment-summary.md exists on disk
            const assessmentSummaryPath = path.join(this.projectService.getAssessmentPath(), 'assessment-summary.md');
            const hasAssessmentSummary = await MigrationProjectService.fileExists(
                vscode.Uri.file(assessmentSummaryPath),
            );

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

            // Phase 3 is complete when both model.json and summary.md exist at the schema-conversion root
            const schemaConversionPath = this.projectService.getSchemaConversionPath();
            const schemaConversionDomainsPath = path.join(schemaConversionPath, 'domains');
            const hasSchemaConversion =
                (await MigrationProjectService.fileExists(
                    MigrationProjectService.toUri(schemaConversionPath, 'model.json'),
                )) &&
                (await MigrationProjectService.fileExists(
                    MigrationProjectService.toUri(schemaConversionPath, 'summary.md'),
                ));

            // Hydrate schema conversion result from disk
            let schemaConversionResult: {
                domains: {
                    name: string;
                    containers: number;
                    entities: number;
                    summaryFilePath: string;
                    modelFilePath: string;
                }[];
                mergedModelFilePath: string;
                summaryFilePath: string;
            } | null = null;
            if (hasSchemaConversion && this.project.phases.schemaConversion?.domains) {
                const conversionPath = this.projectService.getSchemaConversionPath();
                const domainResults: {
                    name: string;
                    containers: number;
                    entities: number;
                    summaryFilePath: string;
                    modelFilePath: string;
                }[] = [];
                for (const domainName of this.project.phases.schemaConversion.domains) {
                    const modelPath = path.join(schemaConversionDomainsPath, domainName, 'cosmos-model.json');
                    let containers = 0;
                    let entities = 0;
                    try {
                        const raw = Buffer.from(
                            await vscode.workspace.fs.readFile(vscode.Uri.file(modelPath)),
                        ).toString('utf-8');
                        const model = JSON.parse(raw) as { containers: { entities: unknown[] }[] };
                        containers = model.containers.length;
                        entities = model.containers.reduce((sum, c) => sum + c.entities.length, 0);
                    } catch {
                        // Model file may not exist
                    }
                    domainResults.push({
                        name: domainName,
                        containers,
                        entities,
                        summaryFilePath: path.join(schemaConversionDomainsPath, domainName, 'summary.md'),
                        modelFilePath: modelPath,
                    });
                }
                schemaConversionResult = {
                    domains: domainResults,
                    mergedModelFilePath: path.join(conversionPath, 'model.json'),
                    summaryFilePath: path.join(conversionPath, 'summary.md'),
                };
            }

            // Detect whether the curated template markdown files exist
            // Templates always live in the default discovery subfolders, not in custom source paths
            const volTemplatePath = path.join(
                this.projectService.getDefaultSubfolderPath('volumetrics'),
                'volumetrics.md',
            );
            const hasVolumetricsTemplate = await MigrationProjectService.fileExists(vscode.Uri.file(volTemplatePath));

            const apTemplatePath = path.join(
                this.projectService.getDefaultSubfolderPath('access-patterns'),
                'access-patterns.md',
            );
            const hasAccessPatternsTemplate = await MigrationProjectService.fileExists(vscode.Uri.file(apTemplatePath));

            // Check if sample-data.json already exists on disk
            const sampleDataPath = path.join(this.projectService.getProvisioningPath(), 'sample-data.json');
            const hasSampleData = await MigrationProjectService.fileExists(vscode.Uri.file(sampleDataPath));

            // Check if the generated Bicep export exists on disk (drives the
            // "Open generated Bicep template" link in Phase 4).
            const hasBicep = await MigrationProjectService.fileExists(
                vscode.Uri.file(this.projectService.getBicepPath()),
            );

            // Check if code-migration-plan.md exists on disk
            const codeMigrationPlanPath = path.join(this.workspacePath, MIGRATION_FOLDER, 'code-migration-plan.md');
            const hasCodeMigrationPlan = await MigrationProjectService.fileExists(
                vscode.Uri.file(codeMigrationPlanPath),
            );

            emitMigrationEvent(this.eventSink, 'projectLoaded', [
                {
                    project: this.project,
                    workspacePath: this.workspacePath,
                    schemaFiles,
                    volumetricFiles,
                    accessPatternFiles,
                    excludedSchemaFiles,
                    excludedVolumetricFiles,
                    excludedAccessPatternFiles,
                    hasDiscoveryReport,
                    hasAssessmentSummary,
                    assessmentResult,
                    hasSchemaConversion,
                    schemaConversionResult,
                    hasSampleData,
                    hasBicep,
                    hasVolumetricsTemplate,
                    hasAccessPatternsTemplate,
                    isAIFeaturesEnabled: Boolean(ext.isAIFeaturesEnabled),
                    consentGiven: Boolean(this.project.consentGiven),
                    hasCodeMigrationPlan,
                    codeMigrationPlanPath,
                    isPhase4Required: IS_PHASE4_REQUIRED,
                    showTokenEstimate: MigrationAssistantTab.getShowTokenEstimateSetting(),
                },
            ]);

            // (Re-)create file watchers using the resolved paths (supports custom folder overrides)
            this.setupFileWatchers();
        });
    }

    /**
     * Create file system watchers for the Phase 1 input folders.
     * Uses resolved paths from projectService so custom folder overrides are respected.
     * Called at the end of loadProject() — watchers are recreated whenever the project reloads
     * (e.g., after a folder selection changes the configured path).
     */
    private setupFileWatchers(): void {
        this.disposeFileWatchers();

        if (!this.project) return;

        // Watch the resolved (potentially custom) source paths
        const watchPaths = new Set([
            this.projectService.getSchemaPath(this.project),
            this.projectService.getVolumetricsPath(this.project),
            this.projectService.getAccessPatternsPath(this.project),
        ]);

        // Also watch the default discovery subfolders for template file changes
        // (templates always live there, even when source paths are overridden)
        watchPaths.add(this.projectService.getDefaultSubfolderPath('volumetrics'));
        watchPaths.add(this.projectService.getDefaultSubfolderPath('access-patterns'));

        for (const watchPath of watchPaths) {
            const pattern = new vscode.RelativePattern(watchPath, '**');
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            const handler = () => this.debouncedRefreshFileState();
            this.fileWatchers.push(watcher.onDidCreate(handler));
            this.fileWatchers.push(watcher.onDidChange(handler));
            this.fileWatchers.push(watcher.onDidDelete(handler));
            this.fileWatchers.push(watcher);
        }

        // Watch for model.json and summary.md in the schema-conversion folder (Phase 3 completion)
        const schemaConversionPath = this.projectService.getSchemaConversionPath();
        for (const fileName of ['model.json', 'summary.md']) {
            const scPattern = new vscode.RelativePattern(schemaConversionPath, fileName);
            const scWatcher = vscode.workspace.createFileSystemWatcher(scPattern);
            const scHandler = () => this.debouncedRefreshFileState();
            this.fileWatchers.push(scWatcher.onDidCreate(scHandler));
            this.fileWatchers.push(scWatcher.onDidChange(scHandler));
            this.fileWatchers.push(scWatcher.onDidDelete(scHandler));
            this.fileWatchers.push(scWatcher);
        }

        // Watch for code-migration-plan.md creation/deletion in the migration root
        const planPattern = new vscode.RelativePattern(
            path.join(this.workspacePath, MIGRATION_FOLDER),
            'code-migration-plan.md',
        );
        const planWatcher = vscode.workspace.createFileSystemWatcher(planPattern);
        const planHandler = () => this.debouncedRefreshFileState();
        this.fileWatchers.push(planWatcher.onDidCreate(planHandler));
        this.fileWatchers.push(planWatcher.onDidChange(planHandler));
        this.fileWatchers.push(planWatcher.onDidDelete(planHandler));
        this.fileWatchers.push(planWatcher);
    }

    /**
     * Dispose all active file watchers and clear the debounce timer.
     */
    private disposeFileWatchers(): void {
        if (this.fileWatcherDebounceTimer) {
            clearTimeout(this.fileWatcherDebounceTimer);
            this.fileWatcherDebounceTimer = undefined;
        }
        for (const d of this.fileWatchers) {
            d.dispose();
        }
        this.fileWatchers = [];
    }

    /**
     * Debounce file-system events so that rapid changes (e.g., pasting multiple files)
     * produce a single refresh cycle.
     */
    private debouncedRefreshFileState(): void {
        if (this.fileWatcherDebounceTimer) {
            clearTimeout(this.fileWatcherDebounceTimer);
        }
        this.fileWatcherDebounceTimer = setTimeout(() => {
            this.fileWatcherDebounceTimer = undefined;
            void this.refreshFileState();
        }, 500);
    }

    /**
     * Lightweight refresh that re-reads file lists and key artifact existence from disk,
     * then posts a `filesChanged` event to the webview.
     * Unlike full loadProject(), this does NOT re-read project.json or reset UI state.
     */
    private async refreshFileState(): Promise<void> {
        if (!this.project) return;

        // Hide the curated template files from the UI (see loadProject for rationale).
        const volTemplateAbs = this.projectService.getTemplateFilePath('volumetrics');
        const apTemplateAbs = this.projectService.getTemplateFilePath('access-patterns');
        const schemaFiles = await this.projectService.listDiscoveryFiles(this.project, 'schema-ddl');
        const volumetricFiles = (await this.projectService.listDiscoveryFiles(this.project, 'volumetrics')).filter(
            (f) => f !== volTemplateAbs,
        );
        const accessPatternFiles = (
            await this.projectService.listDiscoveryFiles(this.project, 'access-patterns')
        ).filter((f) => f !== apTemplateAbs);
        const excludedSchemaFiles = await this.projectService.listExcludedDiscoveryFiles(this.project, 'schema-ddl');
        const excludedVolumetricFiles = await this.projectService.listExcludedDiscoveryFiles(
            this.project,
            'volumetrics',
        );
        const excludedAccessPatternFiles = await this.projectService.listExcludedDiscoveryFiles(
            this.project,
            'access-patterns',
        );

        // Templates always live in the default discovery subfolders, not in custom source paths
        const volTemplatePath = path.join(this.projectService.getDefaultSubfolderPath('volumetrics'), 'volumetrics.md');
        const hasVolumetricsTemplate = await MigrationProjectService.fileExists(vscode.Uri.file(volTemplatePath));

        const apTemplatePath = path.join(
            this.projectService.getDefaultSubfolderPath('access-patterns'),
            'access-patterns.md',
        );
        const hasAccessPatternsTemplate = await MigrationProjectService.fileExists(vscode.Uri.file(apTemplatePath));

        // Check key artifacts to derive phase completion
        const discoveryReportPath = path.join(this.projectService.getDiscoveryPath(), 'discovery-report.md');
        const hasDiscoveryReport = await MigrationProjectService.fileExists(vscode.Uri.file(discoveryReportPath));

        const assessmentSummaryPath = path.join(this.projectService.getAssessmentPath(), 'assessment-summary.md');
        const hasAssessmentSummary = await MigrationProjectService.fileExists(vscode.Uri.file(assessmentSummaryPath));

        const schemaConversionPath = this.projectService.getSchemaConversionPath();
        const hasSchemaConversion =
            (await MigrationProjectService.fileExists(
                MigrationProjectService.toUri(schemaConversionPath, 'model.json'),
            )) &&
            (await MigrationProjectService.fileExists(
                MigrationProjectService.toUri(schemaConversionPath, 'summary.md'),
            ));

        const sampleDataPath = path.join(this.projectService.getProvisioningPath(), 'sample-data.json');
        const hasSampleData = await MigrationProjectService.fileExists(vscode.Uri.file(sampleDataPath));

        const hasBicep = await MigrationProjectService.fileExists(vscode.Uri.file(this.projectService.getBicepPath()));

        this.fileStateGeneration++;

        // Check if code-migration-plan.md exists on disk
        const codeMigrationPlanPath = path.join(this.workspacePath, MIGRATION_FOLDER, 'code-migration-plan.md');
        const hasCodeMigrationPlan = await MigrationProjectService.fileExists(vscode.Uri.file(codeMigrationPlanPath));

        emitMigrationEvent(this.eventSink, 'filesChanged', [
            {
                schemaFiles,
                volumetricFiles,
                accessPatternFiles,
                excludedSchemaFiles,
                excludedVolumetricFiles,
                excludedAccessPatternFiles,
                hasVolumetricsTemplate,
                hasAccessPatternsTemplate,
                hasDiscoveryReport,
                hasAssessmentSummary,
                hasSchemaConversion,
                hasSampleData,
                hasBicep,
                hasCodeMigrationPlan,
                codeMigrationPlanPath,
                fileStateGeneration: this.fileStateGeneration,
            },
        ]);
    }

    private async updateProjectName(name: string): Promise<void> {
        if (!this.project) return;
        this.project.name = name;
        await this.saveProject();
    }

    private async updateConsent(consent: boolean): Promise<void> {
        if (!this.project) return;
        this.project.consentGiven = consent;
        await this.saveProject();
    }

    /**
     * Save the project and (re)register the workspace item so the tree reflects the current name.
     */
    private async saveProject(): Promise<void> {
        if (!this.project) return;

        await this.projectService.save(this.project);

        // addMigration dedupes by path, so calling it on every save keeps the tree entry's
        // name in sync with the latest project.json (e.g. after a rename). It also
        // refreshes the tree view internally when the entry changes.
        await MigrationWorkspaceItem.addMigration(this.project.name, this.workspacePath);
    }

    private async createTemplate(subfolder: 'volumetrics' | 'access-patterns'): Promise<void> {
        if (!this.project) return;

        await this.saveProject();

        // Templates always live in the default discovery subfolder, not in custom source paths
        const folderPath = this.projectService.getDefaultSubfolderPath(subfolder);

        const fileName = subfolder === 'volumetrics' ? 'volumetrics.md' : 'access-patterns.md';
        const filePath = path.join(folderPath, fileName);
        const fileUri = vscode.Uri.file(filePath);

        // Only create the file if it doesn't already exist
        if (!(await MigrationProjectService.fileExists(fileUri))) {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(folderPath));
            const content =
                subfolder === 'volumetrics' ? getVolumetricsTemplateContent() : getAccessPatternsTemplateContent();
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf-8'));
        }

        await vscode.window.showTextDocument(fileUri, { preview: false });
        await this.loadProject();
    }

    private async openTemplate(subfolder: 'volumetrics' | 'access-patterns'): Promise<void> {
        if (!this.project) return;

        // Templates always live in the default discovery subfolder, not in custom source paths
        const folderPath = this.projectService.getDefaultSubfolderPath(subfolder);

        const fileName = subfolder === 'volumetrics' ? 'volumetrics.md' : 'access-patterns.md';
        const filePath = path.join(folderPath, fileName);
        const fileUri = vscode.Uri.file(filePath);

        if (await MigrationProjectService.fileExists(fileUri)) {
            await vscode.window.showTextDocument(fileUri, { preview: false });
        } else {
            // Template doesn't exist — fall back to creating it
            await this.createTemplate(subfolder);
        }
    }

    private async analyzeWithAI(subfolder: 'volumetrics' | 'access-patterns'): Promise<void> {
        if (!this.project) return;
        await runAnalyzeWithAI(subfolder, this.project, this.projectService);
    }

    private async analyzeDatabaseSchema(): Promise<void> {
        if (!this.project) return;
        await runAnalyzeDatabaseSchema(this.project, this.projectService);
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

        const inWorkspace = fileUris.filter((uri) => this.projectService.isInsideWorkspace(uri.fsPath));
        const external = fileUris.filter((uri) => !this.projectService.isInsideWorkspace(uri.fsPath));

        if (external.length > 0) {
            const copy = await vscode.window.showInformationMessage(
                l10n.t(
                    'Some selected files are outside the workspace. Would you like to copy them to the migration project?',
                ),
                { modal: true },
                l10n.t('Copy'),
            );
            if (!copy) return;
        }

        // Check if all in-workspace files share the same parent directory
        const uniqueDirs = new Set(inWorkspace.map((uri) => path.dirname(uri.fsPath)));
        const allFromSameDir = inWorkspace.length > 0 && uniqueDirs.size === 1 && external.length === 0;

        if (allFromSameDir) {
            // Reference the in-workspace folder by path — no file copying.
            // Record the exact files the user picked as an `includedFiles` allowlist
            // so siblings in the same directory don't leak into the selection and
            // newly-added siblings don't auto-appear later.
            const relativePath = this.projectService.getRelativePath([...uniqueDirs][0]);
            const includedFiles = inWorkspace.map((uri) => path.basename(uri.fsPath));
            this.updateProjectPath(subfolder, relativePath, includedFiles);
        } else {
            // Mixed sources or multiple directories — copy everything to the default subfolder
            await this.projectService.copyFilesToSubfolder(fileUris, subfolder);
            // Clear any previously-set custom path so getSchemaPath/etc. falls back to the default subfolder
            this.clearProjectPath(subfolder);
        }

        await this.saveProject();
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
                .map(([name]) => MigrationProjectService.toUri(folderUri.fsPath, name));

            await this.projectService.copyFilesToSubfolder(fileUris, subfolder);
            // Clear any previously-set custom path so getSchemaPath/etc. falls back to the default subfolder
            this.clearProjectPath(subfolder);
        }

        await this.saveProject();
        await this.loadProject();
    }

    private updateProjectPath(subfolder: string, relativePath: string, includedFiles?: string[]): void {
        if (!this.project) return;

        const discovery = this.project.phases.discovery;
        const source: { path: string; includedFiles?: string[] } = { path: relativePath };
        if (includedFiles && includedFiles.length > 0) source.includedFiles = includedFiles;
        switch (subfolder) {
            case 'schema-ddl':
                discovery.schemaInventory = source;
                break;
            case 'volumetrics':
                discovery.volumetrics = source;
                break;
            case 'access-patterns':
                discovery.accessPatterns = source;
                break;
        }
    }

    private clearProjectPath(subfolder: string): void {
        if (!this.project) return;

        const discovery = this.project.phases.discovery;
        switch (subfolder) {
            case 'schema-ddl':
                delete discovery.schemaInventory;
                break;
            case 'volumetrics':
                delete discovery.volumetrics;
                break;
            case 'access-patterns':
                delete discovery.accessPatterns;
                break;
        }
    }

    /**
     * Remove a single discovery source file from the project.
     *
     * - When the source folder is a workspace reference, the file is excluded via
     *   `excludedFiles` in project.json (the workspace file is left untouched). If
     *   the removal would leave the source empty, the folder reference is cleared.
     * - When the source folder lives inside `.cosmosdb-migration`, the file is
     *   deleted from disk after user confirmation.
     */
    private async removeDiscoveryFile(
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
        filePath: string,
    ): Promise<void> {
        if (!this.project) return;

        const displayName = path.basename(filePath);

        // Predefined templates are part of the migration scaffolding and must not be removable.
        if (
            (subfolder === 'volumetrics' && displayName === 'volumetrics.md') ||
            (subfolder === 'access-patterns' && displayName === 'access-patterns.md')
        ) {
            return;
        }

        const isWorkspaceRef = this.projectService.isWorkspaceReferenced(this.project, subfolder);
        const base = this.projectService.getDiscoverySourcePath(this.project, subfolder);
        const relative = path.relative(base, filePath);
        const discovery = this.project.phases.discovery;

        if (isWorkspaceRef) {
            const source =
                subfolder === 'schema-ddl'
                    ? discovery.schemaInventory
                    : subfolder === 'volumetrics'
                      ? discovery.volumetrics
                      : discovery.accessPatterns;
            if (!source) return;

            const remaining = (await this.projectService.listDiscoveryFiles(this.project, subfolder)).filter(
                (f) => path.relative(base, f) !== relative,
            );

            if (remaining.length === 0) {
                // Last visible file: clear the workspace folder reference entirely.
                this.clearProjectPath(subfolder);
            } else if (source.includedFiles !== undefined) {
                // File-pick mode: remove from the allowlist (no "excluded" concept here).
                source.includedFiles = source.includedFiles.filter((p) => p !== relative);
            } else {
                // Folder mode: hide the sibling via excludedFiles so it can be restored.
                const excluded = new Set(source.excludedFiles ?? []);
                excluded.add(relative);
                source.excludedFiles = [...excluded];
            }
        } else {
            const confirm = await vscode.window.showWarningMessage(
                l10n.t('Delete "{0}" from the migration project? This cannot be undone.', displayName),
                { modal: true },
                l10n.t('Delete'),
            );
            if (confirm !== l10n.t('Delete')) return;

            try {
                await vscode.workspace.fs.delete(vscode.Uri.file(filePath), { useTrash: false });
            } catch (err) {
                void vscode.window.showErrorMessage(
                    l10n.t('Failed to delete file: {0}', err instanceof Error ? err.message : String(err)),
                );
                return;
            }
        }

        await this.saveProject();
        await this.loadProject();
    }

    /**
     * Re-include a previously-excluded discovery file by removing it from
     * `excludedFiles` in project.json.
     */
    private async restoreDiscoveryFile(
        subfolder: 'schema-ddl' | 'volumetrics' | 'access-patterns',
        filePath: string,
    ): Promise<void> {
        if (!this.project) return;

        const discovery = this.project.phases.discovery;
        const source =
            subfolder === 'schema-ddl'
                ? discovery.schemaInventory
                : subfolder === 'volumetrics'
                  ? discovery.volumetrics
                  : discovery.accessPatterns;
        if (!source?.excludedFiles?.length) return;

        const base = this.projectService.getDiscoverySourcePath(this.project, subfolder);
        const relative = path.relative(base, filePath);
        const next = source.excludedFiles.filter((p) => p !== relative);
        if (next.length === source.excludedFiles.length) return;

        if (next.length === 0) {
            delete source.excludedFiles;
        } else {
            source.excludedFiles = next;
        }

        await this.saveProject();
        await this.loadProject();
    }

    private async analyzeApplication(): Promise<void> {
        if (!this.project) return;
        this.analysisCancellation = resetCancellationToken(this.analysisCancellation);
        await runApplicationAnalysis({
            project: this.project,
            projectService: this.projectService,
            channel: this.eventSink,
            cancellationToken: this.analysisCancellation.token,
        });
    }

    private async updateAnalysisResult(updates: Record<string, unknown>): Promise<void> {
        if (!this.project) return;

        const existing = this.project.phases.discovery.applicationAnalysis ?? {};
        const field = Object.keys(updates)[0];
        const value = updates[field];

        if (field === 'frameworks' && Array.isArray(value)) {
            existing.frameworks = value as string[];
        } else {
            (existing as Record<string, unknown>)[field] = value;
        }

        this.project.phases.discovery.applicationAnalysis = existing;
        await this.saveProject();
    }

    private async cancelAnalysis(): Promise<void> {
        this.analysisCancellation = await cancelAnalysis(this.analysisCancellation, this.eventSink);
    }

    private async runDiscovery(): Promise<void> {
        if (!this.project) return;
        this.discoveryCancellation = resetCancellationToken(this.discoveryCancellation);
        await runDiscoveryReport({
            project: this.project,
            projectService: this.projectService,
            channel: this.eventSink,
            cancellationToken: this.discoveryCancellation.token,
        });
    }

    private async cancelDiscovery(): Promise<void> {
        this.discoveryCancellation = await cancelDiscovery(this.discoveryCancellation, this.eventSink);
    }

    private async runAssessment(): Promise<void> {
        if (!this.project) return;
        this.assessmentCancellation = resetCancellationToken(this.assessmentCancellation);
        await runAssessment({
            project: this.project,
            projectService: this.projectService,
            channel: this.eventSink,
            cancellationToken: this.assessmentCancellation.token,
        });
    }

    private async cancelAssessment(): Promise<void> {
        this.assessmentCancellation = await cancelAssessment(this.assessmentCancellation, this.eventSink);
    }

    private async runSchemaConversion(includeUnmappedDomains?: boolean, thoroughAnalysis?: boolean): Promise<void> {
        if (!this.project) return;
        this.schemaConversionCancellation = resetCancellationToken(this.schemaConversionCancellation);
        await runSchemaConversion(
            {
                project: this.project,
                projectService: this.projectService,
                channel: this.eventSink,
                cancellationToken: this.schemaConversionCancellation.token,
            },
            includeUnmappedDomains,
            thoroughAnalysis,
        );
    }

    private async cancelSchemaConversion(): Promise<void> {
        this.schemaConversionCancellation = await cancelSchemaConversion(
            this.schemaConversionCancellation,
            this.eventSink,
        );
    }

    private async setTargetEnvironment(
        type: 'emulator' | 'azure' | 'provision',
        endpoint?: string,
        resourceGroup?: string,
        accountName?: string,
        location?: string,
    ): Promise<void> {
        if (!this.project) return;

        // Merge-only: when a parameter is `undefined` *or* `null`, keep the previously
        // persisted value. The webview's `sendCommand` serialises args via JSON, which
        // converts trailing `undefined` array entries to `null`; treating `null` the
        // same as `undefined` here ensures partial updates (e.g. account-name-only
        // edits via `handleAccountNameChange`) don't clobber resource group / endpoint
        // / location with `null`. This lets users switch between "Azure account" and
        // "Provision new" without losing previously selected fields. The "Azure Cosmos
        // DB Account" and "Provision new…" options intentionally share the same
        // `endpoint` property, so a successfully provisioned endpoint is prefilled
        // when the user switches back to the existing-account option.
        const existing = this.project.phases.targetEnvironment;
        this.project.phases.targetEnvironment = {
            ...existing,
            type,
            ...(endpoint !== undefined && endpoint !== null && { endpoint }),
            ...(resourceGroup !== undefined && resourceGroup !== null && { resourceGroup }),
            ...(accountName !== undefined && accountName !== null && { accountName }),
            ...(location !== undefined && location !== null && { location }),
            verified: false,
        };
        await this.saveProject();
    }

    private async selectAccount(): Promise<void> {
        if (!this.project) return;

        await callWithTelemetryAndErrorHandling('cosmosDB.migration.selectAccount', async (context) => {
            setMigrationTelemetryContext(context, this.project);
            const source = await vscode.window.showQuickPick(
                [
                    {
                        label: l10n.t('From Azure Subscription'),
                        description: l10n.t('Select from your Azure subscriptions'),
                        source: 'azure' as const,
                    },
                    {
                        label: l10n.t('From Workspace Connections'),
                        description: l10n.t('Select from attached accounts'),
                        source: 'workspace' as const,
                    },
                ],
                { placeHolder: l10n.t('Select account source') },
            );

            if (!source) return;

            let node: CosmosDBAccountResourceItem | CosmosDBAccountAttachedResourceItem;
            if (source.source === 'azure') {
                node = await pickAppResource<CosmosDBAccountResourceItem>(context, {
                    type: [AzExtResourceType.AzureCosmosDb],
                });
            } else {
                node = await pickWorkspaceResource<CosmosDBAccountAttachedResourceItem>(context, {
                    type: [WorkspaceResourceType.AttachedAccounts],
                    expectedChildContextValue: ['treeItem.account'],
                });
            }

            const accountInfo = await getAccountInfo(node.account);
            const entraIdCredential = getCosmosDBEntraIdCredential(accountInfo.credentials);
            const tenantId = entraIdCredential?.tenantId;

            // Store subscription info for RBAC operations when picked from Azure
            let subscriptionId: string | undefined;
            let subscriptionName: string | undefined;
            let resourceGroup: string | undefined;
            if (source.source === 'azure') {
                const azureNode = node as CosmosDBAccountResourceItem;
                this.selectedSubscription = azureNode.account.subscription;
                subscriptionId = azureNode.account.subscription.subscriptionId;
                subscriptionName = azureNode.account.subscription.name;
                resourceGroup = azureNode.account.resourceGroup;
            }

            // Merge into the existing target environment so provision-mode fields the
            // user previously configured (e.g. `location`) survive a switch to an
            // existing account and back.
            this.project!.phases.targetEnvironment = {
                ...this.project!.phases.targetEnvironment,
                type: 'azure',
                endpoint: accountInfo.endpoint,
                accountName: accountInfo.name,
                tenantId,
                subscriptionId,
                subscriptionName,
                resourceGroup,
                verified: false,
            };
            await this.saveProject();

            emitMigrationEvent(this.eventSink, 'accountSelected', [
                {
                    endpoint: accountInfo.endpoint,
                    accountName: accountInfo.name,
                },
            ]);
        });
    }

    private async selectResourceGroup(): Promise<void> {
        if (!this.project) return;

        await callWithTelemetryAndErrorHandling('cosmosDB.migration.selectResourceGroup', async (context) => {
            setMigrationTelemetryContext(context, this.project);
            const subscription = await subscriptionExperience(
                context,
                ext.rgApiV2.resources.azureResourceTreeDataProvider,
            );

            const subscriptionContext = createSubscriptionContext(subscription);
            const wizardContext: IResourceGroupWizardContext = {
                ...context,
                ...subscriptionContext,
            };

            const promptSteps: AzureWizardPromptStep<IResourceGroupWizardContext>[] = [new ResourceGroupListStep()];
            LocationListStep.addStep(wizardContext, promptSteps);

            const wizard = new AzureWizard(wizardContext, {
                title: l10n.t('Select Resource Group'),
                promptSteps,
                executeSteps: [new ResourceGroupCreateStep()],
                showLoadingPrompt: true,
            });

            await wizard.prompt();
            await wizard.execute();

            const resourceGroupName = wizardContext.resourceGroup?.name ?? wizardContext.newResourceGroupName ?? '';
            const selectedLocation = await LocationListStep.getLocation(wizardContext);
            const location = selectedLocation.name ?? '';
            const locationDisplayName = selectedLocation.displayName ?? location;

            this.project!.phases.targetEnvironment = {
                ...this.project!.phases.targetEnvironment,
                type: 'provision',
                resourceGroup: resourceGroupName,
                location,
                subscriptionId: subscription.subscriptionId,
                subscriptionName: subscription.name,
                tenantId: subscription.tenantId,
            };
            this.selectedSubscription = subscription;
            await this.saveProject();

            // Refine the generated Bicep export with the values the user just
            // picked so the manual `az deployment group create` invocation has
            // them ready. Subscription / RG go in as breadcrumb comments;
            // location is a Bicep param.
            await refineBicepParams(
                {
                    project: this.project!,
                    projectService: this.projectService,
                    channel: this.eventSink,
                },
                {
                    subscriptionId: subscription.subscriptionId,
                    resourceGroup: resourceGroupName,
                    location,
                },
            );

            emitMigrationEvent(this.eventSink, 'resourceGroupSelected', [
                {
                    subscriptionId: subscription.subscriptionId,
                    subscriptionName: subscription.name,
                    resourceGroup: resourceGroupName,
                    location,
                    locationDisplayName,
                },
            ]);

            // Best-effort: fetch the full Cosmos DB region list for the chosen
            // subscription so the webview can populate its location dropdown. A
            // failure here is non-fatal — the UI will fall back to showing only
            // the resource group's default location.
            void this.listCosmosDBLocations();
        });
    }

    /**
     * Lists every Azure region in which Cosmos DB is offered for the currently
     * selected subscription and posts them to the webview as a `locationsList`
     * event. Results are sorted by display name.
     */
    private async listCosmosDBLocations(): Promise<void> {
        if (!this.selectedSubscription) return;
        const subscription = this.selectedSubscription;
        await callWithTelemetryAndErrorHandling('cosmosDB.migration.listLocations', async (context) => {
            setMigrationTelemetryContext(context, this.project);
            const mgmtClient = await createCosmosDBManagementClient(context, subscription);
            // The Cosmos DB regions API returns the region's display label on `name`
            // (e.g. `East US`) and the canonical short name only as the last segment
            // of `id` (e.g. `eastus`). The resource group's location is the short
            // name, so we extract it from the id to map correctly.
            const locations: { name: string; displayName: string }[] = [];
            for await (const loc of mgmtClient.locations.list()) {
                const shortName = loc.id?.split('/').pop();
                if (shortName) {
                    locations.push({ name: shortName, displayName: loc.name ?? shortName });
                }
            }
            locations.sort((a, b) => a.displayName.localeCompare(b.displayName));
            emitMigrationEvent(this.eventSink, 'locationsList', [locations]);
        });
    }

    /**
     * Persists the user's location selection and refreshes the Bicep export so
     * the generated `main.bicepparam` reflects the chosen region.
     */
    private async setTargetLocation(location: string): Promise<void> {
        if (!this.project || !location) return;
        const existing = this.project.phases.targetEnvironment;
        if (!existing) return;
        await callWithTelemetryAndErrorHandling('cosmosDB.migration.setTargetLocation', async (context) => {
            setMigrationTelemetryContext(context, this.project);
            this.project!.phases.targetEnvironment = {
                ...existing,
                location,
            };
            await this.saveProject();
            await refineBicepParams(
                {
                    project: this.project!,
                    projectService: this.projectService,
                    channel: this.eventSink,
                },
                { location },
            );
        });
    }

    private async testConnection(): Promise<void> {
        if (!this.project) return;
        await testConnection(
            {
                project: this.project,
                projectService: this.projectService,
                channel: this.eventSink,
            },
            this.selectedSubscription,
        );
    }

    private async populateSampleData(): Promise<void> {
        if (!this.project) return;

        this.provisioningCancellation = resetCancellationToken(this.provisioningCancellation);
        await populateSampleData(
            {
                project: this.project,
                projectService: this.projectService,
                channel: this.eventSink,
            },
            this.provisioningCancellation,
        );
    }

    private async provisionNewAccount(): Promise<void> {
        if (!this.project) return;
        const target = this.project.phases.targetEnvironment;
        if (!target) return;

        if (!this.selectedSubscription) {
            // Re-acquire subscription if not stored (e.g., project loaded from disk).
            // If the project already knows which subscription to use, look it up
            // against the signed-in account silently instead of re-prompting.
            await callWithTelemetryAndErrorHandling('cosmosDB.migration.phase4.selectSubscription', async (context) => {
                if (target.subscriptionId) {
                    const subscriptionProvider = new VSCodeAzureSubscriptionProvider();
                    try {
                        if (!(await subscriptionProvider.isSignedIn())) {
                            await subscriptionProvider.signIn(target.tenantId);
                        }
                        const subscriptions = await subscriptionProvider.getSubscriptions(false);
                        this.selectedSubscription = subscriptions.find(
                            (s) => s.subscriptionId === target.subscriptionId,
                        );
                    } finally {
                        subscriptionProvider.dispose();
                    }
                }

                if (!this.selectedSubscription) {
                    this.selectedSubscription = await subscriptionExperience(
                        context,
                        ext.rgApiV2.resources.azureResourceTreeDataProvider,
                    );
                }
            });
        }

        if (!this.selectedSubscription) return;

        // On reload, the persisted project may not yet have an `accountName` even though
        // the UI shows (and submitted for validation) a sanitized default derived from
        // the project name. Apply the same default here and persist it so the backend
        // and project state match the UI.
        let accountName = target.accountName;
        if (!accountName) {
            accountName = sanitizeCosmosDBAccountName(this.project.name) ?? '';
            if (accountName) {
                this.project.phases.targetEnvironment = {
                    ...target,
                    accountName,
                };
                await this.saveProject();
            }
        }

        this.accountProvisioningCancellation = resetCancellationToken(this.accountProvisioningCancellation);

        // Refine the Bicep export with the final account name *before* calling
        // the SDK so the artifact reflects the user's choice even if SDK
        // provisioning fails. Also recovers from the case where the user
        // deleted main.bicep / main.bicepparam between phases 3 and 4.
        await refineBicepParams(
            {
                project: this.project,
                projectService: this.projectService,
                channel: this.eventSink,
            },
            {
                accountName,
                location: target.location,
                subscriptionId: target.subscriptionId,
                resourceGroup: target.resourceGroup,
            },
        );

        const endpoint = await provisionAccount(
            {
                project: this.project,
                projectService: this.projectService,
                channel: this.eventSink,
            },
            target.resourceGroup ?? '',
            accountName,
            target.location ?? 'eastus',
            this.selectedSubscription,
            this.accountProvisioningCancellation.token,
        );

        // If provisioning succeeded, automatically run a connection test so the user
        // doesn't need a separate "Test Connection" click for the provision flow.
        if (endpoint && !this.accountProvisioningCancellation.token.isCancellationRequested) {
            await this.testConnection();
        }
    }

    private cancelProvisioning(): void {
        void cancelProvisioning(this.provisioningCancellation, this.eventSink);
    }

    private cancelAccountProvisioning(): void {
        void cancelAccountProvisioning(this.accountProvisioningCancellation, this.eventSink);
        this.accountProvisioningCancellation = undefined;
    }

    private async resetProject(): Promise<void> {
        if (!this.project) return;

        const resetItem: vscode.MessageItem = { title: l10n.t('Reset') };
        const cancelItem: vscode.MessageItem = { title: l10n.t('Cancel'), isCloseAffordance: true };
        const confirm = await vscode.window.showWarningMessage(
            l10n.t('Are you sure you want to reset this migration? All progress will be lost.'),
            { modal: true },
            resetItem,
            cancelItem,
        );

        if (confirm !== resetItem) return;

        this.project = await this.projectService.reset(this.project);
        await this.loadProject();
    }

    private async updateDiscoveryInstructions(text: string): Promise<void> {
        if (!this.project) return;
        this.project.phases.discovery.discoveryInstructions = text;
        await this.saveProject();
    }

    private async updateAssessmentInstructions(text: string): Promise<void> {
        if (!this.project) return;
        if (!this.project.phases.assessment) {
            this.project.phases.assessment = { status: 'not-started' };
        }
        this.project.phases.assessment.assessmentInstructions = text;
        await this.saveProject();
    }

    private async updateSchemaConversionInstructions(text: string): Promise<void> {
        if (!this.project) return;
        if (!this.project.phases.schemaConversion) {
            this.project.phases.schemaConversion = { status: 'not-started' };
        }
        this.project.phases.schemaConversion.schemaConversionInstructions = text;
        await this.saveProject();
    }

    private async updateMigrationInstructions(text: string): Promise<void> {
        if (!this.project) return;
        this.project.migrationInstructions = text;
        await this.saveProject();
    }

    private async setMigrationMode(mode: 'plan' | 'start'): Promise<void> {
        if (!this.project) return;
        this.project.migrationMode = mode;
        await this.saveProject();
    }

    /**
     * Open Copilot Chat to generate a migration plan and optionally execute it.
     */
    private async executeMigration(mode: 'plan' | 'start'): Promise<void> {
        if (!this.project) return;
        let prompt = buildCodeMigrationPrompt(this.project, MIGRATION_FOLDER, mode);

        if (isDebugPromptsEnabled()) {
            try {
                const debugDir = path.join(this.workspacePath, '.cosmosdb-migration', 'debug-prompts');
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(debugDir));
                const debugPath = path.join(debugDir, `code-migration-${mode}.prompt.md`);

                // Try to load an existing override before overwriting
                try {
                    const existing = Buffer.from(
                        await vscode.workspace.fs.readFile(vscode.Uri.file(debugPath)),
                    ).toString('utf-8');
                    if (existing.trim().length > 0 && existing.trim() !== prompt.trim()) {
                        ext.outputChannel.appendLog(
                            '[DEBUG] ⚠️ OVERRIDE ACTIVE for "code-migration": loaded from code-migration.prompt.md',
                        );
                        prompt = existing;
                    } else {
                        // No meaningful override — dump the freshly generated prompt
                        await vscode.workspace.fs.writeFile(vscode.Uri.file(debugPath), Buffer.from(prompt, 'utf-8'));
                    }
                } catch {
                    // File doesn't exist yet — dump the generated prompt
                    await vscode.workspace.fs.writeFile(vscode.Uri.file(debugPath), Buffer.from(prompt, 'utf-8'));
                }
            } catch (error) {
                console.warn('Failed to handle code migration prompt debug file:', error);
            }
        }

        await vscode.commands.executeCommand('workbench.action.chat.open', {
            query: prompt,
        });
    }

    private async getAvailableModels(): Promise<void> {
        const { models, savedModelId } = await getAvailableModelsInfo(MIGRATION_SELECTED_MODEL_KEY);
        emitMigrationEvent(this.eventSink, 'availableModels', [models, savedModelId]);
    }

    private async setSelectedModel(modelId: string): Promise<void> {
        await ext.context.globalState.update(MIGRATION_SELECTED_MODEL_KEY, modelId);
    }

    /**
     * Estimates the token count for the current schema + access pattern context
     * using the selected model's tokenizer.
     */
    private async estimateContextTokens(): Promise<void> {
        try {
            if (!this.project) return;

            const model = await getSelectedModel();

            ext.outputChannel.appendLog(`[Migration] estimateContextTokens: model="${model.name}" (${model.id})`);

            const estimate = await estimateDiscoveryTokens(
                this.projectService,
                this.project,
                model,
                new vscode.CancellationTokenSource().token,
            );

            emitMigrationEvent(this.eventSink, 'tokenEstimate', [
                estimate
                    ? {
                          minTokens: estimate.minTokens,
                          maxTokens: estimate.maxTokens,
                          modelMaxTokens: model.maxInputTokens,
                          estimateGeneration: this.fileStateGeneration,
                      }
                    : null,
            ]);
        } catch (error) {
            ext.outputChannel.appendLog(
                `[Migration] estimateContextTokens error: ${error instanceof Error ? error.message : String(error)}`,
            );
            emitMigrationEvent(this.eventSink, 'tokenEstimate', [null]);
        }
    }

    private async openFile(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        await vscode.window.showTextDocument(uri, { preview: true });
    }

    private async revealInExplorer(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            await vscode.workspace.fs.createDirectory(uri);
        }
        await vscode.commands.executeCommand('revealInExplorer', uri);
    }

    private async openGeneratedBicep(): Promise<void> {
        const bicepPath = this.projectService.getBicepPath();
        const bicepUri = vscode.Uri.file(bicepPath);
        try {
            await vscode.workspace.fs.stat(bicepUri);
        } catch {
            await vscode.window.showInformationMessage(
                l10n.t(
                    'The generated Bicep template was not found. It will be regenerated the next time you run schema conversion.',
                ),
            );
            return;
        }

        await vscode.window.showTextDocument(bicepUri, { preview: false });

        // Suggest installing the official Bicep extension if missing — without it
        // VS Code only offers plain-text editing (no syntax highlighting,
        // validation or hover docs) for `.bicep` files. The prompt runs
        // alongside the open editor so the user isn't blocked; once installed,
        // the tab automatically picks up full language support.
        const bicepExtensionId = 'ms-azuretools.vscode-bicep';
        if (!vscode.extensions.getExtension(bicepExtensionId)) {
            const install = l10n.t('Install Bicep extension');
            void vscode.window
                .showInformationMessage(
                    l10n.t(
                        'For full Bicep editing support (syntax highlighting, validation, IntelliSense), install the Bicep extension.',
                    ),
                    install,
                )
                .then((choice) => {
                    if (choice === install) {
                        return vscode.commands.executeCommand(
                            'workbench.extensions.installExtension',
                            bicepExtensionId,
                        );
                    }
                    return undefined;
                });
        }
    }

    private async previewMarkdown(filePath: string): Promise<void> {
        const uri = vscode.Uri.file(filePath);
        await vscode.commands.executeCommand('markdown.showPreview', uri);
    }

    private async checkGitRepository(): Promise<void> {
        const hasGit = await this.hasGitRepository();
        emitMigrationEvent(this.eventSink, 'gitStatus', [hasGit]);
        if (hasGit) {
            await this.checkGitignore();
        }
    }

    private async checkGitignore(): Promise<void> {
        const isInGitignore = await this.projectService.isInGitignore();
        emitMigrationEvent(this.eventSink, 'gitignoreStatus', [isInGitignore]);
    }

    private async addToGitignore(): Promise<void> {
        await this.projectService.addToGitignore();
        await this.checkGitignore();
    }

    private async removeFromGitignore(): Promise<void> {
        await this.projectService.removeFromGitignore();
        await this.checkGitignore();
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
                await api.init(vscode.Uri.file(this.workspacePath));
                await this.checkGitRepository();
                return;
            }
        } catch {
            // Fall back to terminal
        }

        const terminal = vscode.window.createTerminal({ name: 'Git Init', cwd: this.workspacePath });
        terminal.sendText('git init');
        terminal.show();

        // Re-check after a delay
        setTimeout(() => void this.checkGitRepository(), 3000);
    }
}
