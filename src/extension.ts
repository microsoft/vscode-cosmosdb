/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import { AzureTreeDataProvider, AzureTreeItem, AzureUserInput, callWithTelemetryAndErrorHandling, createApiProvider, createTelemetryReporter, IActionContext, registerCommand, registerEvent, registerUIExtensionVariables, SubscriptionTreeItem } from 'vscode-azureextensionui';
import { AzureExtensionApi, AzureExtensionApiProvider } from 'vscode-azureextensionui/api';
import { findTreeItem } from './commands/api/findTreeItem';
import { pickTreeItem } from './commands/api/pickTreeItem';
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
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
import { MongoCollectionTreeItem } from './mongo/tree/MongoCollectionTreeItem';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { TableAccountTreeItem } from './table/tree/TableAccountTreeItem';
import { AttachedAccountsTreeItem, AttachedAccountSuffix } from './tree/AttachedAccountsTreeItem';
import { CosmosDBAccountProvider } from './tree/CosmosDBAccountProvider';

export async function activateInternal(context: vscode.ExtensionContext, perfStats: { loadStartTime: number, loadEndTime: number }): Promise<AzureExtensionApiProvider> {
    ext.context = context;
    ext.reporter = createTelemetryReporter(context);
    ext.ui = new AzureUserInput(context.globalState);
    ext.outputChannel = vscode.window.createOutputChannel("Azure Cosmos DB");
    context.subscriptions.push(ext.outputChannel);
    registerUIExtensionVariables(ext);

    await callWithTelemetryAndErrorHandling('cosmosDB.activate', async function (this: IActionContext): Promise<void> {
        this.properties.isActivationEvent = 'true';
        this.measurements.mainFileLoad = (perfStats.loadEndTime - perfStats.loadStartTime) / 1000;

        const attachedAccountsNode: AttachedAccountsTreeItem = new AttachedAccountsTreeItem(context.globalState);
        ext.attachedAccountsNode = attachedAccountsNode;
        const tree: AzureTreeDataProvider = new AzureTreeDataProvider(CosmosDBAccountProvider, 'cosmosDB.loadMore', [attachedAccountsNode]);
        context.subscriptions.push(tree);
        ext.tree = tree;
        context.subscriptions.push(vscode.window.registerTreeDataProvider('cosmosDBExplorer', tree));

        ext.treeView = vscode.window.createTreeView('cosmosDBExplorer', { treeDataProvider: tree });

        const editorManager: CosmosEditorManager = new CosmosEditorManager(context.globalState);

        registerDocDBCommands(editorManager);
        registerGraphCommands(context);
        registerMongoCommands(context, editorManager);

        // Common commands
        const accountContextValues: string[] = [GraphAccountTreeItem.contextValue, DocDBAccountTreeItem.contextValue, TableAccountTreeItem.contextValue, MongoAccountTreeItem.contextValue];

        registerCommand('cosmosDB.selectSubscriptions', () => vscode.commands.executeCommand("azure-account.selectSubscriptions"));

        registerCommand('cosmosDB.createAccount', async function (this: IActionContext, node?: SubscriptionTreeItem): Promise<void> {
            if (!node) {
                node = <SubscriptionTreeItem>await tree.showTreeItemPicker(SubscriptionTreeItem.contextValue);
            }

            await node.createChild(this);
        });
        registerCommand('cosmosDB.deleteAccount', async (node?: AzureTreeItem) => {
            if (!node) {
                node = await tree.showTreeItemPicker(accountContextValues);
            }

            await node.deleteTreeItem();
        });

        registerCommand('cosmosDB.attachDatabaseAccount', async () => {
            await attachedAccountsNode.attachNewAccount();
            await tree.refresh(attachedAccountsNode);
        });
        registerCommand('cosmosDB.attachEmulator', async () => {
            await attachedAccountsNode.attachEmulator();
            await tree.refresh(attachedAccountsNode);
        });
        registerCommand('cosmosDB.refresh', async (node?: AzureTreeItem) => await tree.refresh(node));
        registerCommand('cosmosDB.detachDatabaseAccount', async (node?: AzureTreeItem) => {
            if (!node) {
                node = await tree.showTreeItemPicker(accountContextValues.map((val: string) => val += AttachedAccountSuffix), attachedAccountsNode);
            }

            await attachedAccountsNode.detach(node);
            await tree.refresh(attachedAccountsNode);
        });
        registerCommand('cosmosDB.importDocument', async (selectedNode: vscode.Uri | MongoCollectionTreeItem | DocDBCollectionTreeItem, uris: vscode.Uri[]) => //ignore first pass
        {
            if (selectedNode instanceof vscode.Uri) {
                await importDocuments(uris || [selectedNode], undefined);
            } else {
                await importDocuments(undefined, selectedNode);
            }
        });

        registerCommand('cosmosDB.openInPortal', async (node?: AzureTreeItem) => {
            if (!node) {
                node = await tree.showTreeItemPicker(accountContextValues);
            }

            await node.openInPortal();
        });
        registerCommand('cosmosDB.copyConnectionString', async (node?: MongoAccountTreeItem | DocDBAccountTreeItemBase) => {
            if (!node) {
                node = <MongoAccountTreeItem | DocDBAccountTreeItemBase>await tree.showTreeItemPicker(accountContextValues);
            }

            await copyConnectionString(node);
        });
        registerCommand('cosmosDB.openDocument', async (node?: MongoDocumentTreeItem | DocDBDocumentTreeItem) => {
            if (!node) {
                node = <MongoDocumentTreeItem | DocDBDocumentTreeItem>await tree.showTreeItemPicker([MongoDocumentTreeItem.contextValue, DocDBDocumentTreeItem.contextValue]);
            }

            const editorTabName = node.label + "-cosmos-document.json";
            if (node instanceof MongoDocumentTreeItem) {
                await editorManager.showDocument(new MongoDocumentNodeEditor(node), editorTabName);
            } else {
                await editorManager.showDocument(new DocDBDocumentNodeEditor(node), editorTabName);
            }
            // tslint:disable-next-line:align
        }, doubleClickDebounceDelay);
        registerCommand('cosmosDB.update', (filePath: vscode.Uri) => editorManager.updateMatchingNode(filePath));
        registerCommand('cosmosDB.loadMore', (node?: AzureTreeItem) => tree.loadMore(node));
        registerEvent('cosmosDB.CosmosEditorManager.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument, async function (
            this: IActionContext, doc: vscode.TextDocument): Promise<void> {
            await editorManager.onDidSaveTextDocument(this, doc);
        });
        registerEvent(
            'cosmosDB.onDidChangeConfiguration',
            vscode.workspace.onDidChangeConfiguration,
            async function (this: IActionContext, event: vscode.ConfigurationChangeEvent): Promise<void> {
                this.properties.isActivationEvent = "true";
                this.suppressErrorDisplay = true;
                if (event.affectsConfiguration(ext.settingsKeys.documentLabelFields)) {
                    await vscode.commands.executeCommand("cosmosDB.refresh");
                }
            });
    });

    return createApiProvider([<AzureExtensionApi>{
        findTreeItem,
        pickTreeItem,
        apiVersion: '1.0.0'
    }]);
}

async function copyConnectionString(node: MongoAccountTreeItem | DocDBAccountTreeItemBase) {
    await vscode.env.clipboard.writeText(node.connectionString);
}

// this method is called when your extension is deactivated
export function deactivateInternal() {
    // NOOP
}
