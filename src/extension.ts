/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import {
    apiUtils,
    callWithTelemetryAndErrorHandling,
    createApiProvider,
    createAzExtLogOutputChannel,
    registerErrorHandler,
    registerEvent,
    registerReportIssueCommand,
    registerUIExtensionVariables,
    TreeElementStateManager,
    type AzExtParentTreeItem,
    type AzureExtensionApi,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import {
    AzExtResourceType,
    getAzureResourcesExtensionApi,
    type AzureResourcesExtensionApi,
} from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { CosmosDbChatParticipant } from './chat';
import { registerCommands } from './commands/registerCommands';
import { getIsRunningOnAzure } from './cosmosdb/utils/managedIdentityUtils';
import { DatabasesFileSystem } from './DatabasesFileSystem';
import { ClustersExtension } from './documentdb/ClustersExtension';
import { ext } from './extensionVariables';
import { getResourceGroupsApi } from './getExtensionApi';
import { StorageNames, StorageService } from './services/storageService';
import { CosmosDBBranchDataProvider } from './tree/azure-resources-view/cosmosdb/CosmosDBBranchDataProvider';
import { DatabaseResolver } from './tree/v1-legacy-api/resolver/AppResolver';
import { DatabaseWorkspaceProvider } from './tree/v1-legacy-api/resolver/DatabaseWorkspaceProvider';
import {
    SharedWorkspaceResourceProvider,
    WorkspaceResourceType,
} from './tree/workspace-api/SharedWorkspaceResourceProvider';
import { CosmosDBWorkspaceBranchDataProvider } from './tree/workspace-view/cosmosdb/CosmosDBWorkspaceBranchDataProvider';
import { DisabledClustersWorkspaceBranchDataProvider } from './tree/workspace-view/documentdb-disabled/DisabledClustersWorkspaceBranchDataProvider';
import { globalUriHandler } from './vscodeUriHandler';

// Interface for the MongoDB connection migration API
interface MongoConnectionMigrationApi extends AzureExtensionApi {
    apiVersion: string;
    exportMongoClusterConnections(callingExtensionContext: vscode.ExtensionContext): Promise<unknown[] | undefined>;
    renameMongoClusterConnectionStorageId(
        callingExtensionContext: vscode.ExtensionContext,
        oldId: string,
        newId: string,
    ): Promise<boolean>;
}

export async function activateInternal(
    context: vscode.ExtensionContext,
    perfStats: { loadStartTime: number; loadEndTime: number },
): Promise<apiUtils.AzureExtensionApiProvider> {
    ext.context = context;
    ext.isBundle = !!process.env.IS_BUNDLE;

    ext.outputChannel = createAzExtLogOutputChannel('Azure Databases');
    context.subscriptions.push(ext.outputChannel);
    registerUIExtensionVariables(ext);
    registerAzureUtilsExtensionVariables(ext);

    if (vscode.l10n.uri) {
        l10n.config({
            contents: vscode.l10n.bundle ?? {},
        });
    }

    await callWithTelemetryAndErrorHandling('cosmosDB.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        ext.secretStorage = context.secrets;

        // Early initialization to determine whether Managed Identity is available for authentication
        void getIsRunningOnAzure();

        // getAzureResourcesExtensionApi provides a way to get the Azure Resources extension's API V2
        // and is used to work with the tree view structure, as an improved alternative to the
        // AzureResourceGraph API V1 provided by the getResourceGroupsApi call above.
        // TreeElementStateManager is needed here too
        ext.state = new TreeElementStateManager();
        ext.rgApiV2 = (await getAzureResourcesExtensionApi(context, '2.0.0')) as AzureResourcesExtensionApiWithActivity;

        ext.cosmosDBBranchDataProvider = new CosmosDBBranchDataProvider();
        ext.cosmosDBWorkspaceBranchDataProvider = new CosmosDBWorkspaceBranchDataProvider();
        ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
            AzExtResourceType.AzureCosmosDb,
            ext.cosmosDBBranchDataProvider,
        );
        ext.rgApiV2.resources.registerWorkspaceResourceProvider(new SharedWorkspaceResourceProvider());
        ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
            WorkspaceResourceType.AttachedAccounts,
            ext.cosmosDBWorkspaceBranchDataProvider,
        );

        // V1 Legacy API for Postgres support: begin
        ext.rgApi = await getResourceGroupsApi();

        ext.rgApi.registerApplicationResourceResolver(
            AzExtResourceType.PostgresqlServersStandard,
            new DatabaseResolver(),
        );
        ext.rgApi.registerApplicationResourceResolver(
            AzExtResourceType.PostgresqlServersFlexible,
            new DatabaseResolver(),
        );

        const workspaceRootTreeItem = (
            ext.rgApi.workspaceResourceTree as unknown as { _rootTreeItem: AzExtParentTreeItem }
        )._rootTreeItem;
        const databaseWorkspaceProvider = new DatabaseWorkspaceProvider(workspaceRootTreeItem);
        ext.rgApi.registerWorkspaceResourceProvider('AttachedDatabaseAccount', databaseWorkspaceProvider);
        // V1 Legacy API for Postgres support: end

        ext.fileSystem = new DatabasesFileSystem(ext.rgApi.appResourceTree);

        registerCommands();
        // Old commands for old tree view. If need to be quickly returned to V1, uncomment the line below
        // registerCommandsCompatibility();

        // init and activate mongodb RU and vCore support (branch data provider, commands, ...)
        if (await isVCoreAndRURolloutEnabled()) {
            // If the vCore and RU features are disabled in this extension, we register a branch data provider
            // that will inform the user to install the "DocumentDB for VS Code" extension to manage these resources.
            ext.mongoClustersWorkspaceBranchDataProvider = new DisabledClustersWorkspaceBranchDataProvider();
            ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
                WorkspaceResourceType.MongoClustersDisabled,
                ext.mongoClustersWorkspaceBranchDataProvider,
            );
        } else {
            const clustersSupport: ClustersExtension = new ClustersExtension();
            context.subscriptions.push(clustersSupport); // to be disposed when extension is deactivated.
            await clustersSupport.activate();
        }

        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(DatabasesFileSystem.scheme, ext.fileSystem),
        );

        registerEvent(
            'cosmosDB.onDidChangeConfiguration',
            vscode.workspace.onDidChangeConfiguration,
            async (actionContext: IActionContext, event: vscode.ConfigurationChangeEvent) => {
                actionContext.telemetry.properties.isActivationEvent = 'true';
                actionContext.errorHandling.suppressDisplay = true;
                if (event.affectsConfiguration(ext.settingsKeys.documentLabelFields)) {
                    await vscode.commands.executeCommand('azureDatabases.refresh');
                }
            },
        );

        // Initialize the CosmosDB chat participant
        new CosmosDbChatParticipant(context);

        context.subscriptions.push(
            vscode.window.registerUriHandler({
                handleUri: globalUriHandler,
            }),
        );

        // Suppress "Report an Issue" button for all errors in favor of the command
        registerErrorHandler((c) => (c.errorHandling.suppressReportIssue = true));
        registerReportIssueCommand('azureDatabases.reportIssue');
    });

    // TODO: we still don't know for sure if this is needed
    //  If it is, we need to implement the logic to get the correct API version
    const exportedApis = [
        <AzureExtensionApi>{
            apiVersion: '1.2.0',
            findTreeItem: () => undefined,
            pickTreeItem: () => undefined,
            revealTreeItem: () => undefined,
        },
        /**
         * Temporary API for migrating MongoDB cluster connections to authorized extensions.
         * This is needed to support user data migration from the vscode-cosmosdb extension
         * to the vscode-documentdb extension.
         * The code is inline to keep it easy to maintain and to remove post-migration-phase.
         */
        <MongoConnectionMigrationApi>{
            apiVersion: '2.0.0',
            exportMongoClusterConnections: async (
                callingExtensionContext: vscode.ExtensionContext,
            ): Promise<unknown[] | undefined> => {
                return (
                    (await callWithTelemetryAndErrorHandling(
                        'cosmosDB.exportMongoClusterConnections',
                        async (context: IActionContext) => {
                            // Get the calling extension's ID from the context - this cannot be easily spoofed
                            const callingExtensionId = callingExtensionContext.extension.id;
                            context.telemetry.properties.requestingExtension = callingExtensionId;

                            // Only allow the "DocumentDB for VS Code" extension to access this data
                            if (callingExtensionId !== 'ms-azuretools.vscode-documentdb') {
                                context.telemetry.properties.authorized = 'false';
                                return undefined;
                            }

                            context.telemetry.properties.authorized = 'true';

                            const allItems = await StorageService.get(StorageNames.Workspace).getItems(
                                WorkspaceResourceType.MongoClusters,
                            );

                            context.telemetry.measurements.exportedItemCount = allItems.length;

                            // Return as unknown[] - this is intentional as only the trusted vscode-documentdb
                            // partner extension uses this API and we know the schema/interface matches
                            return allItems as unknown[];
                        },
                    )) ?? undefined
                );
            },
            renameMongoClusterConnectionStorageId: async (
                callingExtensionContext: vscode.ExtensionContext,
                oldId: string,
                newId: string,
            ): Promise<boolean> => {
                return (
                    (await callWithTelemetryAndErrorHandling(
                        'cosmosDB.renameMongoClusterConnectionStorageId',
                        async (context: IActionContext) => {
                            // Get the calling extension's ID from the context - this cannot be easily spoofed
                            const callingExtensionId = callingExtensionContext.extension.id;
                            context.telemetry.properties.requestingExtension = callingExtensionId;

                            // Only allow the "DocumentDB for VS Code" extension to access this data
                            if (callingExtensionId !== 'ms-azuretools.vscode-documentdb') {
                                context.telemetry.properties.authorized = 'false';
                                return false;
                            }

                            context.telemetry.properties.authorized = 'true';
                            context.telemetry.properties.oldId = oldId;
                            context.telemetry.properties.newId = newId;

                            const storageService = StorageService.get(StorageNames.Workspace);

                            // 1. Get all items to find the one with the old ID
                            const allItems = await storageService.getItems(WorkspaceResourceType.MongoClusters);
                            const itemToRename = allItems.find((item) => item.id === oldId);

                            if (!itemToRename) {
                                context.telemetry.properties.renameResult = 'item_not_found';
                                return false;
                            }

                            // 2. Create a new item with the new ID but preserve all other properties
                            const newItem = { ...itemToRename, id: newId };

                            // 3. Save the new item first to ensure we don't lose data
                            await storageService.push(WorkspaceResourceType.MongoClusters, newItem, true);

                            // 4. Remove the old item
                            await storageService.delete(WorkspaceResourceType.MongoClusters, oldId);

                            context.telemetry.properties.renameResult = 'success';
                            return true;
                        },
                    )) ?? false
                ); // Return false if there was an error
            },
        },
    ];

    console.log(
        'Registering APIs:',
        exportedApis.map((a) => a.apiVersion),
    );

    vscode.commands.executeCommand('cosmosDB.ai.deployInstructionFiles');

    return createApiProvider(exportedApis);
}

// this method is called when your extension is deactivated
export function deactivateInternal(_context: vscode.ExtensionContext): void {
    // NOOP
}

/**
 * Checks if vCore and RU features are to be enabled or disabled.
 * This introduces multiple changes to the behavior of the extension.
 *
 * This function is used to determine whether the vCore and RU features should be disabled in this extension.
 * The result of this function depends on the release of a new version of Azure Resources extension.
 * When a new version of the Azure Resources extension is released and emits the signal to roll out the change,
 * this function will return true.
 *
 * When this function returns true, the extension's behavior changes significantly:
 * - The `ClustersExtension`, which contains all the logic for MongoDB vCore and RU support (including commands and tree data providers), will not be activated.
 * - In the workspace view, the regular MongoDB nodes will be replaced by a special node (`DisabledClustersWorkspaceBranchDataProvider`).
 * - This special node informs the user that the functionality has moved and prompts them to install the new "DocumentDB for VS Code" extension.
 * - Once the "DocumentDB for VS Code" extension is installed, this prompt will be hidden to avoid clutter.
 *
 * @returns True if vCore and RU features are enabled, false | undefined otherwise.
 */
export async function isVCoreAndRURolloutEnabled(): Promise<boolean | undefined> {
    return callWithTelemetryAndErrorHandling('isVCoreAndRURolloutEnabled', async (context: IActionContext) => {
        // Suppress error display and don't rethrow - this is feature detection that should fail gracefully
        context.errorHandling.suppressDisplay = true;
        context.errorHandling.rethrow = false;

        const azureResourcesExtensionApi = await apiUtils.getAzureExtensionApi<
            AzureResourcesExtensionApi & { isDocumentDbExtensionSupportEnabled: () => boolean }
        >(ext.context, 'ms-azuretools.vscode-azureresourcegroups', '3.0.0');

        // Check if the feature is enabled via the API function
        if (typeof azureResourcesExtensionApi.isDocumentDbExtensionSupportEnabled === 'function') {
            const isEnabled = azureResourcesExtensionApi.isDocumentDbExtensionSupportEnabled();
            context.telemetry.properties.vCoreAndRURolloutEnabled = String(isEnabled);
            context.telemetry.properties.apiMethodAvailable = 'true';
            return isEnabled;
        }

        // If the function doesn't exist, assume DISABLED
        context.telemetry.properties.vCoreAndRURolloutEnabled = 'false';
        context.telemetry.properties.apiMethodAvailable = 'false';
        ext.outputChannel.appendLog(
            'Expected Azure Resources API v3.0.0 is not available; VCore and RU support remains active in Azure Databases.',
        );
        return false;
    });
}

/**
 * Checks if the "DocumentDB for VS Code" extension is installed.
 * This is used to coordinate behavior between this extension and the new DocumentDB extension,
 * for example, to avoid duplicating features or to prompt the user to install the new extension.
 * @returns true if the extension is installed, false otherwise.
 */
export function isDocumentDBExtensionInstalled(): boolean {
    const extension = vscode.extensions.getExtension('ms-azuretools.vscode-documentdb');
    return extension !== undefined;
}
