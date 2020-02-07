/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { AzExtTreeDataProvider, AzExtTreeItem, AzureTreeItem, AzureUserInput, callWithTelemetryAndErrorHandling, createApiProvider, createAzExtOutputChannel, createTelemetryReporter, IActionContext, registerCommand, registerEvent, registerUIExtensionVariables } from 'vscode-azureextensionui';
import { AzureExtensionApi, AzureExtensionApiProvider } from 'vscode-azureextensionui/api';
import { findTreeItem } from './commands/api/findTreeItem';
import { pickTreeItem } from './commands/api/pickTreeItem';
import { revealTreeItem } from './commands/api/revealTreeItem';
import { importDocuments } from './commands/importDocuments';
import { doubleClickDebounceDelay } from './constants';
import { CosmosEditorManager } from './CosmosEditorManager';
import { DocDBDocumentNodeEditor } from './docdb/editors/DocDBDocumentNodeEditor';
import { registerDocDBCommands } from './docdb/registerDocDBCommands';
import { DocDBAccountTreeItem } from './docdb/tree/DocDBAccountTreeItem';
import { DocDBAccountTreeItemBase } from './docdb/tree/DocDBAccountTreeItemBase';
import { DocDBCollectionTreeItem } from './docdb/tree/DocDBCollectionTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { ext } from './extensionVariables';
import { registerGraphCommands } from './graph/registerGraphCommands';
import { GraphAccountTreeItem } from './graph/tree/GraphAccountTreeItem';
import { MongoDocumentNodeEditor } from './mongo/editors/MongoDocumentNodeEditor';
import { registerMongoCommands } from './mongo/registerMongoCommands';
import { setConnectedNode } from './mongo/setConnectedNode';
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
import { MongoCollectionTreeItem } from './mongo/tree/MongoCollectionTreeItem';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { TableAccountTreeItem } from './table/tree/TableAccountTreeItem';
import { AttachedAccountSuffix } from './tree/AttachedAccountsTreeItem';
import { AzureAccountTreeItemWithAttached } from './tree/AzureAccountTreeItemWithAttached';
import { SubscriptionTreeItem } from './tree/SubscriptionTreeItem';

// tslint:disable-next-line: max-func-body-length
export async function activateInternal(context: vscode.ExtensionContext, perfStats: { loadStartTime: number, loadEndTime: number }): Promise<AzureExtensionApiProvider> {
    ext.context = context;
    ext.reporter = createTelemetryReporter(context);
    ext.ui = new AzureUserInput(context.globalState);

    const extensionPrefix: string = 'cosmosDB';
    ext.outputChannel = createAzExtOutputChannel("Azure Cosmos DB", extensionPrefix);
    context.subscriptions.push(ext.outputChannel);
    registerUIExtensionVariables(ext);

    // tslint:disable-next-line: max-func-body-length
    await callWithTelemetryAndErrorHandling('cosmosDB.activate', async (activateContext: IActionContext) => {
        activateContext.telemetry.properties.isActivationEvent = 'true';
        activateContext.telemetry.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        ext.azureAccountTreeItem = new AzureAccountTreeItemWithAttached();
        context.subscriptions.push(ext.azureAccountTreeItem);
        ext.tree = new AzExtTreeDataProvider(ext.azureAccountTreeItem, 'cosmosDB.loadMore');
        ext.treeView = vscode.window.createTreeView('cosmosDBExplorer', { treeDataProvider: ext.tree, showCollapseAll: true });
        context.subscriptions.push(ext.treeView);

        const editorManager: CosmosEditorManager = new CosmosEditorManager(context.globalState);

        registerDocDBCommands(editorManager);
        registerGraphCommands();
        const codeLensProvider = registerMongoCommands(editorManager);

        const accountContextValues: string[] = [GraphAccountTreeItem.contextValue, DocDBAccountTreeItem.contextValue, TableAccountTreeItem.contextValue, MongoAccountTreeItem.contextValue];

        registerCommand('cosmosDB.selectSubscriptions', () => vscode.commands.executeCommand("azure-account.selectSubscriptions"));

        registerCommand('cosmosDB.createAccount', async (actionContext: IActionContext, node?: SubscriptionTreeItem) => {
            if (!node) {
                node = await ext.tree.showTreeItemPicker(SubscriptionTreeItem.contextValue, actionContext);
            }

            await node.createChild(actionContext);
        });
        registerCommand('cosmosDB.deleteAccount', async (actionContext: IActionContext, node?: AzureTreeItem) => {
            if (!node) {
                node = await ext.tree.showTreeItemPicker(accountContextValues, actionContext);
            }

            await node.deleteTreeItem(actionContext);
        });

        registerCommand('cosmosDB.attachDatabaseAccount', async () => {
            await ext.attachedAccountsNode.attachNewAccount();
            await ext.tree.refresh(ext.attachedAccountsNode);
        });
        registerCommand('cosmosDB.attachEmulator', async () => {
            await ext.attachedAccountsNode.attachEmulator();
            await ext.tree.refresh(ext.attachedAccountsNode);
        });
        registerCommand('cosmosDB.refresh', async (_actionContext: IActionContext, node?: AzExtTreeItem) => await ext.tree.refresh(node));
        registerCommand('cosmosDB.detachDatabaseAccount', async (actionContext: IActionContext, node?: AzureTreeItem) => {
            if (!node) {
                node = await ext.tree.showTreeItemPicker(accountContextValues.map((val: string) => val += AttachedAccountSuffix), actionContext);
            }
            if (node instanceof MongoAccountTreeItem) {
                if (ext.connectedMongoDB && node.fullId === ext.connectedMongoDB.parent.fullId) {
                    setConnectedNode(undefined, codeLensProvider);
                    await node.refresh();
                }
            }
            await ext.attachedAccountsNode.detach(node);
            await ext.tree.refresh(ext.attachedAccountsNode);
        });
        registerCommand('cosmosDB.importDocument', async (actionContext: IActionContext, selectedNode: vscode.Uri | MongoCollectionTreeItem | DocDBCollectionTreeItem, uris: vscode.Uri[]) => {
            if (selectedNode instanceof vscode.Uri) {
                await importDocuments(actionContext, uris || [selectedNode], undefined);
            } else {
                await importDocuments(actionContext, undefined, selectedNode);
            }
        });
        registerCommand('cosmosDB.openInPortal', async (actionContext: IActionContext, node?: AzureTreeItem) => {
            if (!node) {
                node = await ext.tree.showTreeItemPicker(accountContextValues, actionContext);
            }

            await node.openInPortal();
        });
        registerCommand('cosmosDB.copyConnectionString', async (actionContext: IActionContext, node?: MongoAccountTreeItem | DocDBAccountTreeItemBase) => {
            const message = 'The connection string has been copied to the clipboard';
            if (!node) {
                node = await ext.tree.showTreeItemPicker(accountContextValues, actionContext);
            }

            await copyConnectionString(node);
            vscode.window.showInformationMessage(message);
        });
        registerCommand('cosmosDB.openDocument', async (actionContext: IActionContext, node?: MongoDocumentTreeItem | DocDBDocumentTreeItem) => {
            if (!node) {
                node = await ext.tree.showTreeItemPicker([MongoDocumentTreeItem.contextValue, DocDBDocumentTreeItem.contextValue], actionContext);
            }

            const editorTabName = node.label + "-cosmos-document.json";
            if (node instanceof MongoDocumentTreeItem) {
                await editorManager.showDocument(actionContext, new MongoDocumentNodeEditor(node), editorTabName);
            } else {
                await editorManager.showDocument(actionContext, new DocDBDocumentNodeEditor(node), editorTabName);
            }
            // tslint:disable-next-line:align
        }, doubleClickDebounceDelay);
        registerCommand('cosmosDB.update', async (actionContext: IActionContext, uri: vscode.Uri) => await editorManager.updateMatchingNode(actionContext, uri));
        registerCommand('cosmosDB.loadMore', async (actionContext: IActionContext, node?: AzExtTreeItem) => await ext.tree.loadMore(node, actionContext));
        registerEvent(
            'cosmosDB.CosmosEditorManager.onDidSaveTextDocument',
            vscode.workspace.onDidSaveTextDocument,
            async (actionContext: IActionContext, doc: vscode.TextDocument) => await editorManager.onDidSaveTextDocument(actionContext, doc)
        );
        registerEvent(
            'cosmosDB.onDidChangeConfiguration',
            vscode.workspace.onDidChangeConfiguration,
            async (actionContext: IActionContext, event: vscode.ConfigurationChangeEvent) => {
                actionContext.telemetry.properties.isActivationEvent = "true";
                actionContext.errorHandling.suppressDisplay = true;
                if (event.affectsConfiguration(ext.settingsKeys.documentLabelFields)) {
                    await vscode.commands.executeCommand("cosmosDB.refresh");
                }
            });
    });

    return createApiProvider([<AzureExtensionApi>{
        findTreeItem,
        pickTreeItem,
        revealTreeItem,
        apiVersion: '1.1.0'
    }]);
}

async function copyConnectionString(node: MongoAccountTreeItem | DocDBAccountTreeItemBase) {
    await vscode.env.clipboard.writeText(node.connectionString);
}

// this method is called when your extension is deactivated
export function deactivateInternal() {
    // NOOP
}
