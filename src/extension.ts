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
    type ITreeItemPickerContext,
} from '@microsoft/vscode-azext-utils';
import { AzExtResourceType, getAzureResourcesExtensionApi } from '@microsoft/vscode-azureresources-api';
import { platform } from 'os';
import * as vscode from 'vscode';
import { findTreeItem } from './commands/api/findTreeItem';
import { pickTreeItem } from './commands/api/pickTreeItem';
import { revealTreeItem } from './commands/api/revealTreeItem';
import { deleteDatabaseAccount } from './commands/deleteDatabaseAccount/deleteDatabaseAccount';
import { importDocuments } from './commands/importDocuments';
import {
    cosmosGremlinFilter,
    cosmosMongoFilter,
    cosmosTableFilter,
    doubleClickDebounceDelay,
    sqlFilter,
} from './constants';
import { DatabasesFileSystem } from './DatabasesFileSystem';
import { registerDocDBCommands } from './docdb/registerDocDBCommands';
import { DocDBAccountTreeItem } from './docdb/tree/DocDBAccountTreeItem';
import { type DocDBAccountTreeItemBase } from './docdb/tree/DocDBAccountTreeItemBase';
import { type DocDBCollectionTreeItem } from './docdb/tree/DocDBCollectionTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { ext } from './extensionVariables';
import { getResourceGroupsApi } from './getExtensionApi';
import { registerGraphCommands } from './graph/registerGraphCommands';
import { GraphAccountTreeItem } from './graph/tree/GraphAccountTreeItem';
import { registerMongoCommands } from './mongo/registerMongoCommands';
import { setConnectedNode } from './mongo/setConnectedNode';
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { MongoClustersExtension } from './mongoClusters/MongoClustersExtension';
import { registerPostgresCommands } from './postgres/commands/registerPostgresCommands';
import { DatabaseResolver } from './resolver/AppResolver';
import { DatabaseWorkspaceProvider } from './resolver/DatabaseWorkspaceProvider';
import { TableAccountTreeItem } from './table/tree/TableAccountTreeItem';
import { AttachedAccountSuffix } from './tree/AttachedAccountsTreeItem';
import { CosmosDBBranchDataProvider } from './tree/CosmosDBBranchDataProvider';
import { CosmosDBWorkspaceBranchDataProvider } from './tree/CosmosDBWorkspaceBranchDataProvider';
import { SubscriptionTreeItem } from './tree/SubscriptionTreeItem';
import { isTreeElementWithExperience } from './tree/TreeElementWithExperience';
import {
    SharedWorkspaceResourceProvider,
    WorkspaceResourceType,
} from './tree/workspace/SharedWorkspaceResourceProvider';
import { localize } from './utils/localize';

const cosmosDBTopLevelContextValues: string[] = [
    GraphAccountTreeItem.contextValue,
    DocDBAccountTreeItem.contextValue,
    TableAccountTreeItem.contextValue,
    MongoAccountTreeItem.contextValue,
];

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
        ext.rgApiV2 = await getAzureResourcesExtensionApi(context, '2.0.0');

        // ext.rgApi.registerApplicationResourceResolver(AzExtResourceType.AzureCosmosDb, new DatabaseResolver());
        ext.rgApiV2.resources.registerAzureResourceBranchDataProvider(
            AzExtResourceType.AzureCosmosDb,
            new CosmosDBBranchDataProvider(),
        );
        ext.rgApiV2.resources.registerWorkspaceResourceProvider(new SharedWorkspaceResourceProvider());
        ext.rgApiV2.resources.registerWorkspaceResourceBranchDataProvider(
            WorkspaceResourceType.AttachedAccounts,
            new CosmosDBWorkspaceBranchDataProvider(),
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

        registerCommandWithTreeNodeUnwrapping('cosmosDB.selectSubscriptions', () =>
            vscode.commands.executeCommand('azure-account.selectSubscriptions'),
        );

        registerCommandWithTreeNodeUnwrapping('azureDatabases.createServer', createServer);
        registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', deleteAccount);
        registerCommandWithTreeNodeUnwrapping(
            'cosmosDB.attachDatabaseAccount',
            async (actionContext: IActionContext) => {
                await ext.attachedAccountsNode.attachNewAccount(actionContext);
                await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
            },
        );
        registerCommandWithTreeNodeUnwrapping('cosmosDB.attachEmulator', async (actionContext: IActionContext) => {
            if (platform() !== 'win32') {
                actionContext.errorHandling.suppressReportIssue = true;
                throw new Error(
                    localize('emulatorNotSupported', 'The Cosmos DB emulator is only supported on Windows.'),
                );
            }

            await ext.attachedAccountsNode.attachEmulator(actionContext);
            await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
        });
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
            'azureDatabases.detachDatabaseAccount',
            async (actionContext: IActionContext & ITreeItemPickerContext, node?: AzExtTreeItem) => {
                const children = await ext.attachedAccountsNode.loadAllChildren(actionContext);
                if (children.length < 2) {
                    const message = localize('noAttachedAccounts', 'There are no Attached Accounts.');
                    void vscode.window.showInformationMessage(message);
                } else {
                    if (!node) {
                        node = await ext.rgApi.workspaceResourceTree.showTreeItemPicker<AzExtTreeItem>(
                            cosmosDBTopLevelContextValues.map((val: string) => (val += AttachedAccountSuffix)),
                            actionContext,
                        );
                    }
                    if (node instanceof MongoAccountTreeItem) {
                        if (ext.connectedMongoDB && node.fullId === ext.connectedMongoDB.parent.fullId) {
                            setConnectedNode(undefined);
                            await node.refresh(actionContext);
                        }
                    }
                    await ext.attachedAccountsNode.detach(node);
                    await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
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
        registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', cosmosDBCopyConnectionString);
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

export async function createServer(context: IActionContext, node?: SubscriptionTreeItem): Promise<void> {
    if (!node) {
        node = await ext.rgApi.appResourceTree.showTreeItemPicker<SubscriptionTreeItem>(
            SubscriptionTreeItem.contextValue,
            context,
        );
    }

    await SubscriptionTreeItem.createChild(context, node);
}

export async function deleteAccount(context: IActionContext, node?: AzExtTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await ext.rgApi.pickAppResource<AzExtTreeItem>(context, {
            filter: [cosmosMongoFilter, cosmosTableFilter, cosmosGremlinFilter, sqlFilter],
        });
    }

    await deleteDatabaseAccount(context, node, false);
}

export async function cosmosDBCopyConnectionString(
    context: IActionContext,
    node?: MongoAccountTreeItem | DocDBAccountTreeItemBase,
): Promise<void> {
    const message = 'The connection string has been copied to the clipboard';
    if (!node) {
        node = await ext.rgApi.pickAppResource<MongoAccountTreeItem | DocDBAccountTreeItemBase>(context, {
            filter: [cosmosMongoFilter, cosmosTableFilter, cosmosGremlinFilter, sqlFilter],
        });
    }

    await vscode.env.clipboard.writeText(node.connectionString);
    void vscode.window.showInformationMessage(message);
}
