/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { SqlLanguageService } from '@cosmosdb/nosql-language-service';
import { registerCosmosDbSql } from '@cosmosdb/nosql-language-service/vscode';
import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import {
    callWithTelemetryAndErrorHandling,
    createApiProvider,
    createAzExtLogOutputChannel,
    registerErrorHandler,
    registerEvent,
    registerReportIssueCommand,
    registerUIExtensionVariables,
    TreeElementStateManager,
    type apiUtils,
    type AzureExtensionApi,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import {
    AzExtResourceType,
    prepareAzureResourcesApiRequest,
    type AzureResourcesApiRequestContext,
    type AzureResourcesExtensionApi,
} from '@microsoft/vscode-azureresources-api';
import * as fabric from '@microsoft/vscode-fabric-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { CosmosDbChatParticipant, registerSampleDataTool } from './chat';
import { registerE2eTestCommands } from './commands/e2eTestCommands/registerE2eTestCommands';
import {
    affectsMigrationFeatureSetting,
    isMigrationFeatureEnabled,
    MIGRATION_ENABLED_CONTEXT_KEY,
} from './commands/migration/migrationFeatureFlag';
import { registerCommands } from './commands/registerCommands';
import { type FabricArtifactType } from './constants';
import { cleanupLLMInstructionsFiles } from './cosmosdb/commands/cleanupLLMInstructionsFiles';
import { SCHEMA_STORAGE_KEY } from './cosmosdb/cosmosdb-shared-constants';
import { getIsRunningOnAzure } from './cosmosdb/utils/managedIdentityUtils';
import {
    CosmosDBShellExtension,
    registerCosmosDBShellLanguageServer,
    registerMcpServer,
} from './cosmosDBShell/CosmosDBShellExtension';
import { DatabasesFileSystem } from './DatabasesFileSystem';
import { ext } from './extensionVariables';
import { MigrationAssistantTab } from './panels/MigrationAssistantTab';
import { QueryEditorTab } from './panels/QueryEditorTab';
import { FabricService } from './services/FabricService';
import { SchemaFileStorage } from './services/SchemaFileStorage';
import { CosmosDBBranchDataProvider } from './tree/azure-resources-view/cosmosdb/CosmosDBBranchDataProvider';
import { FabricTreeNodeProvider } from './tree/fabric-resources-view/FabricTreeNodeProvider';
import {
    SharedWorkspaceResourceProvider,
    WorkspaceResourceType,
} from './tree/workspace-api/SharedWorkspaceResourceProvider';
import { CosmosDBWorkspaceBranchDataProvider } from './tree/workspace-view/cosmosdb/CosmosDBWorkspaceBranchDataProvider';
import { MigrationWorkspaceBranchDataProvider } from './tree/workspace-view/migration/MigrationWorkspaceBranchDataProvider';
import { areAIFeaturesEnabled, onCopilotAvailabilityChanged } from './utils/copilotUtils';
import { globalUriHandler } from './vscodeUriHandler';

export async function activateInternal(
    context: vscode.ExtensionContext,
): Promise<apiUtils.AzureExtensionApiProvider | undefined> {
    const startTime = performance.now();

    // Initialize Azure utils ext variables
    // Must be before calling registerUIExtensionVariables
    ext.context = context;
    ext.isBundle = !!process.env.IS_BUNDLE;
    ext.outputChannel = createAzExtLogOutputChannel('Azure Cosmos DB');
    context.subscriptions.push(ext.outputChannel);

    // Register Azure resources providers
    // Must be before calling callWithTelemetryAndErrorHandling
    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    return callWithTelemetryAndErrorHandling('cosmosDB.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.startTime = startTime;
        activateContext.telemetry.properties.migrationFeatureEnabled = String(isMigrationFeatureEnabled());

        // eslint-disable-next-line no-restricted-syntax
        if (vscode.l10n.uri) {
            const l10nStartTime = performance.now();

            l10n.config({
                // eslint-disable-next-line no-restricted-syntax
                contents: vscode.l10n.bundle ?? {},
            });

            activateContext.telemetry.measurements.l10nLoadTime = performance.now() - l10nStartTime;
        }

        // Migrate schemas from globalState (SQLite) to file-based storage
        // This is idempotent and safe to call on every activation
        void SchemaFileStorage.getInstance().migrateFromGlobalState(SCHEMA_STORAGE_KEY);

        // Remove obsolete LLM instruction files and clear the manifest from globalState
        void cleanupLLMInstructionsFiles();

        // Early initialization to determine whether Managed Identity is available for authentication
        // Requires ext.outputChannel to be set
        void getIsRunningOnAzure();

        ext.secretStorage = context.secrets;
        ext.state = new TreeElementStateManager();
        ext.cosmosDBBranchDataProvider = new CosmosDBBranchDataProvider();
        ext.cosmosDBWorkspaceBranchDataProvider = new CosmosDBWorkspaceBranchDataProvider();
        ext.migrationWorkspaceBranchDataProvider = new MigrationWorkspaceBranchDataProvider();
        ext.fileSystem = new DatabasesFileSystem();

        const cosmosDBShellSupport: CosmosDBShellExtension = new CosmosDBShellExtension();
        context.subscriptions.push(cosmosDBShellSupport);
        await cosmosDBShellSupport.activate();

        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(DatabasesFileSystem.scheme, ext.fileSystem),
        );

        context.subscriptions.push(vscode.window.registerUriHandler({ handleUri: globalUriHandler }));

        registerCommands();

        // Mirror the experimental migration feature toggle into a context key so package.json
        // `when` clauses can show/hide the migration commands. Kept in sync on config change below.
        void vscode.commands.executeCommand('setContext', MIGRATION_ENABLED_CONTEXT_KEY, isMigrationFeatureEnabled());
        if (context.extensionMode === vscode.ExtensionMode.Development) {
            void vscode.commands.executeCommand('setContext', 'cosmosDB.devMode', true);
            const { registerNl2QueryQualityTestCommand } = await import('./commands/nl2queryQualityTest');
            registerNl2QueryQualityTestCommand(context);
        }

        // Test-only commands for the Playwright e2e suite. No-op unless the
        // `COSMOSDB_E2E_TEST` env var is set (production users never enable it).
        registerE2eTestCommands();

        const nosqlLanguageService = new SqlLanguageService({ multiQuery: true });
        registerCosmosDbSql(vscode, nosqlLanguageService, context, { languageId: 'nosql' });

        // Auto-detect migration projects in the workspace
        void MigrationAssistantTab.promptToReopen();

        registerEvent(
            'cosmosDB.onDidChangeConfiguration',
            vscode.workspace.onDidChangeConfiguration,
            async (actionContext: IActionContext, event: vscode.ConfigurationChangeEvent) => {
                actionContext.telemetry.properties.isActivationEvent = 'true';
                actionContext.errorHandling.suppressDisplay = true;
                if (event.affectsConfiguration(ext.settingsKeys.documentLabelFields)) {
                    await vscode.commands.executeCommand('azureDatabases.refresh');
                }

                if (event.affectsConfiguration('telemetry.feedback.enabled')) {
                    Array.from(QueryEditorTab.openTabs).forEach((tab) => tab.refreshSurveyFeedbackVisibility());
                }

                if (affectsMigrationFeatureSetting(event)) {
                    const migrationEnabled = isMigrationFeatureEnabled();
                    // Update the context key (toggles command/menu visibility) and refresh the
                    // workspace tree so the Cosmos DB Migrations node appears/disappears live.
                    await vscode.commands.executeCommand('setContext', MIGRATION_ENABLED_CONTEXT_KEY, migrationEnabled);
                    ext.sharedWorkspaceResourceProvider?.refresh();
                    await callWithTelemetryAndErrorHandling('cosmosDB.migration.featureToggle', (toggleContext) => {
                        toggleContext.errorHandling.suppressDisplay = true;
                        toggleContext.errorHandling.rethrow = false;
                        toggleContext.telemetry.properties.enabled = String(migrationEnabled);
                    });
                }
            },
        );

        // Initialize the CosmosDB chat participant
        // The chat participant is always registered, but will show helpful error messages
        // if AI features are not available (Copilot not installed, not signed in, or disabled)

        // Register the availability-change listener BEFORE the initial async check.
        // This prevents a race where Copilot finishes initializing (fires
        // onDidChangeChatModels) during the `await areAIFeaturesEnabled()` below —
        // without the listener in place that event would be lost and
        // `ext.isAIFeaturesEnabled` would stay `false` forever.
        context.subscriptions.push(
            onCopilotAvailabilityChanged((available) => {
                ext.isAIFeaturesEnabled = available;
                // Notify all open QueryEditorTabs about the change
                QueryEditorTab.notifyAIFeaturesChanged(available);
                void MigrationAssistantTab.notifyAIFeaturesChanged(available);
            }),
        );

        ext.isAIFeaturesEnabled = await areAIFeaturesEnabled();

        // Always create the chat participant so users can see why it's not working
        const chatParticipant = new CosmosDbChatParticipant(context);
        void chatParticipant; // Acknowledge the variable is intentionally unused after creation

        // Register language model tools for the chat participant
        registerSampleDataTool(context);

        // Suppress "Report an Issue" button for all errors in favor of the command
        registerErrorHandler((c) => (c.errorHandling.suppressReportIssue = true));
        registerReportIssueCommand('azureDatabases.reportIssue');

        registerMcpServer(context);
        registerCosmosDBShellLanguageServer(context);

        const fabricCore = vscode.extensions.getExtension<fabric.IFabricExtensionManager>('fabric.vscode-fabric');
        if (fabricCore) {
            const fabricStartTime = performance.now();
            if (!fabricCore.isActive) {
                await fabricCore.activate();
            }

            await registerFabricProviders(context, fabricCore.exports);

            activateContext.telemetry.measurements.fabricLoadTime = performance.now() - fabricStartTime;
        }

        // The user can turn off Azure Resources extension. Or do not have it at all, only Fabric.
        let apiProvider: apiUtils.AzureExtensionApiProvider | undefined = undefined;
        const azureResources = vscode.extensions.getExtension('ms-azuretools.vscode-azureresourcegroups');
        if (azureResources) {
            const azureResourcesStartTime = performance.now();
            if (!azureResources.isActive) {
                await azureResources.activate();
            }

            apiProvider = registerAzureResourcesProviders(context);

            activateContext.telemetry.measurements.azureResourcesApiLoadTime =
                performance.now() - azureResourcesStartTime;
        }

        const endTime = performance.now();
        activateContext.telemetry.measurements.endTime = endTime;
        activateContext.telemetry.measurements.totalActivationTime = endTime - startTime;

        return apiProvider;
    });
}

function registerAzureResourcesProviders(_context: vscode.ExtensionContext): apiUtils.AzureExtensionApiProvider {
    const exportedApi: AzureExtensionApi = { apiVersion: '1.2.0' };
    const v2: string = '^2.0.0';
    const requestContext: AzureResourcesApiRequestContext = {
        azureResourcesApiVersions: [v2],
        clientExtensionId: 'ms-azuretools.vscode-cosmosdb',

        // Successful retrieval of Azure Resources APIs will be returned here
        onDidReceiveAzureResourcesApis: (
            azureResourcesApis: (AzureResourcesExtensionApi | AzureExtensionApi | undefined)[],
        ) => {
            const [rgApiV2] = azureResourcesApis;
            if (!rgApiV2) {
                throw new Error(l10n.t('Failed to find a matching Azure Resources API for version "{0}".', v2));
            }

            ext.rgApiV2 = rgApiV2 as AzureResourcesExtensionApiWithActivity;

            ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.AzureCosmosDb,
                ext.cosmosDBBranchDataProvider,
            );
            // Still shows PostgreSQL servers in the tree for now
            ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.PostgresqlServersStandard,
                ext.cosmosDBBranchDataProvider,
            );
            ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
                AzExtResourceType.PostgresqlServersFlexible,
                ext.cosmosDBBranchDataProvider,
            );
            ext.sharedWorkspaceResourceProvider = new SharedWorkspaceResourceProvider();
            _context.subscriptions.push(ext.sharedWorkspaceResourceProvider);
            ext.rgApiV2.resources.registerWorkspaceResourceProvider(ext.sharedWorkspaceResourceProvider);
            ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
                WorkspaceResourceType.AttachedAccounts,
                ext.cosmosDBWorkspaceBranchDataProvider,
            );
            ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
                WorkspaceResourceType.Migrations,
                ext.migrationWorkspaceBranchDataProvider,
            );
        },
    };

    const { clientApi, requestResourcesApis } = prepareAzureResourcesApiRequest(requestContext, exportedApi);

    requestResourcesApis();

    console.log(`Registering APIs: ${exportedApi.apiVersion}, Azure Resources API ${clientApi.apiVersion}`);

    return createApiProvider([clientApi]);
}

function registerFabricProviders(
    context: vscode.ExtensionContext,
    fabricApi: fabric.IFabricExtensionManager,
): Promise<void> {
    try {
        ext.fabricNativeTreeNodeProvider = new FabricTreeNodeProvider(context, 'CosmosDBDatabase');
        ext.fabricMirroredTreeNodeProvider = new FabricTreeNodeProvider(context, 'MirroredDatabase');

        // Register Fabric providers and commands
        // Mirrored DB is currently hidden until we have a better story around it
        const extension: fabric.IFabricExtension & { artifactTypes: FabricArtifactType[] } = {
            identity: context.extension.id,
            apiVersion: String(fabric.apiVersion),
            artifactTypes: ['CosmosDBDatabase' /*, 'MirroredDatabase'*/],
            treeNodeProviders: [ext.fabricNativeTreeNodeProvider /*, ext.fabricMirroredTreeNodeProvider*/],
            localProjectTreeNodeProviders: [],
            artifactHandlers: [
                ...FabricService.getArtifactHandlers('CosmosDBDatabase'),
                ...FabricService.getArtifactHandlers('MirroredDatabase'),
            ],
        };

        ext.fabricServices = fabricApi.addExtension(extension);
    } catch (e) {
        console.error('Error registering Fabric providers:', e);
    }

    return Promise.resolve();
}

// this method is called when your extension is deactivated
export function deactivateInternal(_context: vscode.ExtensionContext): void {
    // NOOP
}
