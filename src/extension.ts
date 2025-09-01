/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

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
    type AzExtParentTreeItem,
    type AzureExtensionApi,
    type IActionContext,
} from '@microsoft/vscode-azext-utils';
import { type AzureResourcesExtensionApiWithActivity } from '@microsoft/vscode-azext-utils/activity';
import { AzExtResourceType, getAzureResourcesExtensionApi } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { registerCommands } from './commands/registerCommands';
import { getIsRunningOnAzure } from './cosmosdb/utils/managedIdentityUtils';
import { DatabasesFileSystem } from './DatabasesFileSystem';
import { ClustersExtension } from './documentdb/ClustersExtension';
import { ext } from './extensionVariables';
import { getResourceGroupsApi } from './getExtensionApi';
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
        if (isVCoreAndRUDisabled()) {
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
    return createApiProvider([
        <AzureExtensionApi>{
            findTreeItem: () => undefined,
            pickTreeItem: () => undefined,
            revealTreeItem: () => undefined,
            apiVersion: '1.2.0',
        },
    ]);
}

// this method is called when your extension is deactivated
export function deactivateInternal(_context: vscode.ExtensionContext): void {
    // NOOP
}

/**
 * Checks if vCore and RU features are to be disabled.
 * This introduces changes to the behavior of the extension.
 *
 * This function is used to determine whether the vCore and RU features should be disabled in this extension.
 * The result of this function depends on the version of the Azure Resources extension.
 * When a new version of the Azure Resources extension is released with the `AzureCosmosDbForMongoDbRu` and `MongoClusters`
 * resource types, this function will return true.
 *
 * This will trigger the deactivation of vCore and RU features in this extension,
 * and users will be prompted to use the "DocumentDB for VS Code" extension for those features.
 * This allows for a phased rollout of the new extension and a smooth transition for users.
 *
 * When this function returns true, the extension's behavior changes significantly:
 * - The `ClustersExtension`, which contains all the logic for MongoDB vCore and RU support (including commands and tree data providers), will not be activated.
 * - In the workspace view, the regular MongoDB nodes will be replaced by a special node (`DisabledClustersWorkspaceBranchDataProvider`).
 * - This special node informs the user that the functionality has moved and prompts them to install the new "DocumentDB for VS Code" extension.
 * - Once the "DocumentDB for VS Code" extension is installed, this prompt will be hidden to avoid clutter.
 *
 * @returns True if vCore and RU features are disabled, false otherwise.
 */
export function isVCoreAndRUDisabled(): boolean {
    const isDisabled = 'AzureCosmosDbForMongoDbRu' in AzExtResourceType && 'MongoClusters' in AzExtResourceType;

    if (!isDisabled) {
        console.log('Azure resource types not available in this environment; VCore and RU support remains active.');
    }

    return isDisabled;
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
