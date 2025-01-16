/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { registerAzureUtilsExtensionVariables } from '@microsoft/vscode-azext-azureutils';
import {
    AzExtTreeItem,
    callWithTelemetryAndErrorHandling,
    createApiProvider,
    createAzExtLogOutputChannel,
    registerCommandWithTreeNodeUnwrapping,
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
import * as vscode from 'vscode';
import { registerAccountCommands } from './commands/account/registerAccountCommands';
import { findTreeItem } from './commands/api/findTreeItem';
import { pickTreeItem } from './commands/api/pickTreeItem';
import { revealTreeItem } from './commands/api/revealTreeItem';
import { importDocuments } from './commands/importDocuments';
import { cosmosMongoFilter, doubleClickDebounceDelay, sqlFilter } from './constants';
import { DatabasesFileSystem } from './DatabasesFileSystem';
import { registerDocDBCommands } from './docdb/registerDocDBCommands';
import { type DocDBCollectionTreeItem } from './docdb/tree/DocDBCollectionTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { ext } from './extensionVariables';
import { getResourceGroupsApi } from './getExtensionApi';
import { registerGraphCommands } from './graph/registerGraphCommands';
import { registerMongoCommands } from './mongo/registerMongoCommands';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { MongoClustersExtension } from './mongoClusters/MongoClustersExtension';
import { registerPostgresCommands } from './postgres/commands/registerPostgresCommands';
import { DatabaseResolver } from './resolver/AppResolver';
import { DatabaseWorkspaceProvider } from './resolver/DatabaseWorkspaceProvider';
import { CosmosDBBranchDataProvider } from './tree/CosmosDBBranchDataProvider';
import { CosmosDBWorkspaceBranchDataProvider } from './tree/CosmosDBWorkspaceBranchDataProvider';
import { isTreeElementWithExperience } from './tree/TreeElementWithExperience';
import {
    SharedWorkspaceResourceProvider,
    WorkspaceResourceType,
} from './tree/workspace/SharedWorkspaceResourceProvider';

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

    await callWithTelemetryAndErrorHandling('cosmosDB.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        ext.secretStorage = context.secrets;

        ext.rgApi = await getResourceGroupsApi();

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

        ext.fileSystem = new DatabasesFileSystem(ext.rgApi.appResourceTree);

        registerAccountCommands();
        registerDocDBCommands();
        registerGraphCommands();
        registerPostgresCommands();
        registerMongoCommands();

        // init and activate mongoClusters-support (branch data provider, commands, ...)
        const mongoClustersSupport: MongoClustersExtension = new MongoClustersExtension();
        context.subscriptions.push(mongoClustersSupport); // to be disposed when extension is deactivated.
        await mongoClustersSupport.activate();

        context.subscriptions.push(
            vscode.workspace.registerFileSystemProvider(DatabasesFileSystem.scheme, ext.fileSystem),
        );

        registerCommandWithTreeNodeUnwrapping(
            'azureDatabases.refresh',
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            async (actionContext: IActionContext, node?: any) => {
                if (node instanceof AzExtTreeItem) {
                    if (node) {
                        await node.refresh(actionContext);
                    } else {
                        await ext.rgApi.appResourceTree.refresh(actionContext, node);
                    }

                    return;
                }

                // the node is not an AzExtTreeItem, so we assume it's a TreeElementWithId, etc., based on the V2 of the Tree API from Azure-Resources

                if (isTreeElementWithExperience(node)) {
                    actionContext.telemetry.properties.experience = node.experience?.api;
                }

                if (node && typeof node === 'object' && 'id' in node) {
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
                    ext.state.notifyChildrenChanged(node.id as string);
                }
            },
        );

        registerCommandWithTreeNodeUnwrapping(
            'cosmosDB.importDocument',
            async (
                actionContext: IActionContext,
                selectedNode: vscode.Uri | DocDBCollectionTreeItem,
                uris: vscode.Uri[],
            ) => {
                if (selectedNode instanceof vscode.Uri) {
                    await importDocuments(actionContext, uris || [selectedNode], undefined);
                } else {
                    await importDocuments(actionContext, undefined, selectedNode);
                }
            },
        );

        registerCommandWithTreeNodeUnwrapping(
            'cosmosDB.openDocument',
            async (actionContext: IActionContext, node?: DocDBDocumentTreeItem) => {
                if (!node) {
                    node = await ext.rgApi.pickAppResource<DocDBDocumentTreeItem>(actionContext, {
                        filter: [cosmosMongoFilter, sqlFilter],
                        expectedChildContextValue: [
                            MongoDocumentTreeItem.contextValue,
                            DocDBDocumentTreeItem.contextValue,
                        ],
                    });
                }

                // Clear un-uploaded local changes to the document before opening https://github.com/microsoft/vscode-cosmosdb/issues/1619
                ext.fileSystem.fireChangedEvent(node);
                await ext.fileSystem.showTextDocument(node);
            },
            doubleClickDebounceDelay,
        );
        registerCommandWithTreeNodeUnwrapping(
            'azureDatabases.update',
            async (_actionContext: IActionContext, uri: vscode.Uri) => await ext.fileSystem.updateWithoutPrompt(uri),
        );
        registerCommandWithTreeNodeUnwrapping(
            'azureDatabases.loadMore',
            async (actionContext: IActionContext, node: AzExtTreeItem) =>
                await ext.rgApi.appResourceTree.loadMore(node, actionContext),
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

        // Suppress "Report an Issue" button for all errors in favor of the command
        registerErrorHandler((c) => (c.errorHandling.suppressReportIssue = true));
        registerReportIssueCommand('azureDatabases.reportIssue');
    });

    return createApiProvider([
        <AzureExtensionApi>{
            findTreeItem,
            pickTreeItem,
            revealTreeItem,
            apiVersion: '1.2.0',
        },
    ]);
}

// this method is called when your extension is deactivated
export function deactivateInternal(_context: vscode.ExtensionContext): void {
    // NOOP
}
