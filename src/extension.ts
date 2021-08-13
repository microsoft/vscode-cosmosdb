/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { platform } from 'os';
import * as vscode from 'vscode';
import { AzExtTreeDataProvider, AzExtTreeItem, callWithTelemetryAndErrorHandling, createApiProvider, createAzExtOutputChannel, IActionContext, ITreeItemPickerContext, openInPortal, registerCommand, registerErrorHandler, registerEvent, registerReportIssueCommand, registerUIExtensionVariables } from 'vscode-azureextensionui';
import { AzureExtensionApi, AzureExtensionApiProvider } from 'vscode-azureextensionui/api';
import { findTreeItem } from './commands/api/findTreeItem';
import { pickTreeItem } from './commands/api/pickTreeItem';
import { revealTreeItem } from './commands/api/revealTreeItem';
import { importDocuments } from './commands/importDocuments';
import { doubleClickDebounceDelay } from './constants';
import { DatabasesFileSystem } from './DatabasesFileSystem';
import { registerDocDBCommands } from './docdb/registerDocDBCommands';
import { DocDBAccountTreeItem } from './docdb/tree/DocDBAccountTreeItem';
import { DocDBAccountTreeItemBase } from './docdb/tree/DocDBAccountTreeItemBase';
import { DocDBCollectionTreeItem } from './docdb/tree/DocDBCollectionTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { ext } from './extensionVariables';
import { registerGraphCommands } from './graph/registerGraphCommands';
import { GraphAccountTreeItem } from './graph/tree/GraphAccountTreeItem';
import { registerMongoCommands } from './mongo/registerMongoCommands';
import { setConnectedNode } from './mongo/setConnectedNode';
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
import { MongoCollectionTreeItem } from './mongo/tree/MongoCollectionTreeItem';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { registerPostgresCommands } from './postgres/commands/registerPostgresCommands';
import { PostgresServerTreeItem } from './postgres/tree/PostgresServerTreeItem';
import { TableAccountTreeItem } from './table/tree/TableAccountTreeItem';
import { AttachedAccountSuffix } from './tree/AttachedAccountsTreeItem';
import { AzureAccountTreeItemWithAttached } from './tree/AzureAccountTreeItemWithAttached';
import { SubscriptionTreeItem } from './tree/SubscriptionTreeItem';
import { tryGetKeyTar } from './utils/keytar';
import { localize } from './utils/localize';

const cosmosDBTopLevelContextValues: string[] = [GraphAccountTreeItem.contextValue, DocDBAccountTreeItem.contextValue, TableAccountTreeItem.contextValue, MongoAccountTreeItem.contextValue];
const allAccountsTopLevelContextValues: string[] = [...cosmosDBTopLevelContextValues, PostgresServerTreeItem.contextValue];

export async function activateInternal(context: vscode.ExtensionContext, perfStats: { loadStartTime: number, loadEndTime: number }, ignoreBundle?: boolean): Promise<AzureExtensionApiProvider> {
    ext.context = context;
    ext.ignoreBundle = ignoreBundle;

    ext.outputChannel = createAzExtOutputChannel("Azure Databases", ext.prefix);
    context.subscriptions.push(ext.outputChannel);
    registerUIExtensionVariables(ext);

    await callWithTelemetryAndErrorHandling('cosmosDB.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        ext.azureAccountTreeItem = new AzureAccountTreeItemWithAttached();
        context.subscriptions.push(ext.azureAccountTreeItem);
        ext.tree = new AzExtTreeDataProvider(ext.azureAccountTreeItem, 'azureDatabases.loadMore');
        ext.treeView = vscode.window.createTreeView('azureDatabasesExplorer', { treeDataProvider: ext.tree, showCollapseAll: true });
        context.subscriptions.push(ext.treeView);
        ext.keytar = tryGetKeyTar();

        registerDocDBCommands();
        registerGraphCommands();
        registerPostgresCommands();
        registerMongoCommands();

        ext.fileSystem = new DatabasesFileSystem(ext.tree);
        context.subscriptions.push(vscode.workspace.registerFileSystemProvider(DatabasesFileSystem.scheme, ext.fileSystem));

        registerCommand('cosmosDB.selectSubscriptions', () => vscode.commands.executeCommand("azure-account.selectSubscriptions"));

        registerCommand('azureDatabases.createServer', createServer);
        registerCommand('cosmosDB.deleteAccount', deleteAccount);
        registerCommand('cosmosDB.attachDatabaseAccount', async (actionContext: IActionContext) => {
            await ext.attachedAccountsNode.attachNewAccount(actionContext);
            await ext.tree.refresh(actionContext, ext.attachedAccountsNode);
        });
        registerCommand('cosmosDB.attachEmulator', async (actionContext: IActionContext) => {
            if (platform() !== 'win32') {
                actionContext.errorHandling.suppressReportIssue = true;
                throw new Error(localize('emulatorNotSupported', 'The Cosmos DB emulator is only supported on Windows.'));
            }

            await ext.attachedAccountsNode.attachEmulator(actionContext);
            await ext.tree.refresh(actionContext, ext.attachedAccountsNode);
        });
        registerCommand('azureDatabases.refresh', async (actionContext: IActionContext, node?: AzExtTreeItem) => await ext.tree.refresh(actionContext, node));
        registerCommand('azureDatabases.detachDatabaseAccount', async (actionContext: IActionContext & ITreeItemPickerContext, node?: AzExtTreeItem) => {
            const children = await ext.attachedAccountsNode.loadAllChildren(actionContext);
            if (children[0].contextValue === "cosmosDBAttachDatabaseAccount") {
                const message = localize('noAttachedAccounts', 'There are no Attached Accounts.');
                void vscode.window.showInformationMessage(message);
            } else {
                if (!node) {
                    node = await ext.tree.showTreeItemPicker<AzExtTreeItem>(cosmosDBTopLevelContextValues.map((val: string) => val += AttachedAccountSuffix), actionContext);
                }
                if (node instanceof MongoAccountTreeItem) {
                    if (ext.connectedMongoDB && node.fullId === ext.connectedMongoDB.parent.fullId) {
                        setConnectedNode(undefined);
                        await node.refresh(actionContext);
                    }
                }
                await ext.attachedAccountsNode.detach(node);
                await ext.tree.refresh(actionContext, ext.attachedAccountsNode);
            }
        });
        registerCommand('cosmosDB.importDocument', async (actionContext: IActionContext, selectedNode: vscode.Uri | MongoCollectionTreeItem | DocDBCollectionTreeItem, uris: vscode.Uri[]) => {
            if (selectedNode instanceof vscode.Uri) {
                await importDocuments(actionContext, uris || [selectedNode], undefined);
            } else {
                await importDocuments(actionContext, undefined, selectedNode);
            }
        });
        registerCommand('azureDatabases.openInPortal', async (actionContext: IActionContext, node?: AzExtTreeItem) => {
            if (!node) {
                node = await ext.tree.showTreeItemPicker<AzExtTreeItem>(allAccountsTopLevelContextValues, actionContext);
            }

            await openInPortal(node, node.fullId)
        });
        registerCommand('cosmosDB.copyConnectionString', cosmosDBCopyConnectionString);
        registerCommand('cosmosDB.openDocument', async (actionContext: IActionContext, node?: MongoDocumentTreeItem | DocDBDocumentTreeItem) => {
            if (!node) {
                node = await ext.tree.showTreeItemPicker<MongoDocumentTreeItem | DocDBDocumentTreeItem>([MongoDocumentTreeItem.contextValue, DocDBDocumentTreeItem.contextValue], actionContext);
            }

            // Clear un-uploaded local changes to the document before opening https://github.com/microsoft/vscode-cosmosdb/issues/1619
            ext.fileSystem.fireChangedEvent(node);
            await ext.fileSystem.showTextDocument(node);
        }, doubleClickDebounceDelay);
        registerCommand('azureDatabases.update', async (_actionContext: IActionContext, uri: vscode.Uri) => await ext.fileSystem.updateWithoutPrompt(uri));
        registerCommand('azureDatabases.loadMore', async (actionContext: IActionContext, node: AzExtTreeItem) => await ext.tree.loadMore(node, actionContext));
        registerEvent(
            'cosmosDB.onDidChangeConfiguration',
            vscode.workspace.onDidChangeConfiguration,
            async (actionContext: IActionContext, event: vscode.ConfigurationChangeEvent) => {
                actionContext.telemetry.properties.isActivationEvent = "true";
                actionContext.errorHandling.suppressDisplay = true;
                if (event.affectsConfiguration(ext.settingsKeys.documentLabelFields)) {
                    await vscode.commands.executeCommand("azureDatabases.refresh");
                }
            });

        // Suppress "Report an Issue" button for all errors in favor of the command
        registerErrorHandler(c => c.errorHandling.suppressReportIssue = true);
        registerReportIssueCommand('azureDatabases.reportIssue');
    });

    return createApiProvider([<AzureExtensionApi>{
        findTreeItem,
        pickTreeItem,
        revealTreeItem,
        apiVersion: '1.2.0'
    }]);
}

// this method is called when your extension is deactivated
export function deactivateInternal(): void {
    // NOOP
}

export async function createServer(context: IActionContext, node?: SubscriptionTreeItem): Promise<void> {
    if (!node) {
        node = await ext.tree.showTreeItemPicker<SubscriptionTreeItem>(SubscriptionTreeItem.contextValue, context);
    }

    await node.createChild(context);
}

export async function deleteAccount(context: IActionContext, node?: AzExtTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await ext.tree.showTreeItemPicker<AzExtTreeItem>(cosmosDBTopLevelContextValues, context);
    }

    await node.deleteTreeItem(context);
}

export async function cosmosDBCopyConnectionString(context: IActionContext, node?: MongoAccountTreeItem | DocDBAccountTreeItemBase): Promise<void> {
    const message = 'The connection string has been copied to the clipboard';
    if (!node) {
        node = await ext.tree.showTreeItemPicker<MongoAccountTreeItem | DocDBAccountTreeItemBase>(cosmosDBTopLevelContextValues, context);
    }

    await vscode.env.clipboard.writeText(node.connectionString);
    void vscode.window.showInformationMessage(message);
}
