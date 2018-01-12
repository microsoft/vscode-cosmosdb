/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as copypaste from 'copy-paste';
import * as vscodeUtil from './utils/vscodeUtils';
import * as cpUtil from './utils/cp';
import { AzureAccount } from './azure-account.api';
import { ErrorData } from './utils/ErrorData';
import { AzureTreeDataProvider, IAzureNode, IAzureParentNode, UserCancelledError, AzureActionHandler } from 'vscode-azureextensionui';
import { MongoCommands } from './mongo/commands';
import { DocDBAccountTreeItemBase } from './docdb/tree/DocDBAccountTreeItemBase';
import MongoDBLanguageClient from './mongo/languageClient';
import { Reporter, reporter } from './utils/telemetry';
import { CosmosEditorManager } from './CosmosEditorManager';
import { GraphViewsManager } from "./graph/GraphViewsManager";
import { CosmosDBAccountProvider } from './tree/CosmosDBAccountProvider';
import { AttachedAccountsTreeItem } from './tree/AttachedAccountsTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { GraphCollectionTreeItem } from './graph/tree/GraphCollectionTreeItem';
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { MongoDocumentNodeEditor } from './mongo/editors/MongoDocumentNodeEditor';
import { MongoCollectionNodeEditor } from './mongo/editors/MongoCollectionNodeEditor';
import { DocDBDocumentNodeEditor } from './docdb/editors/DocDBDocumentNodeEditor';
import { MongoDatabaseTreeItem } from './mongo/tree/MongoDatabaseTreeItem';
import { MongoCollectionTreeItem } from './mongo/tree/MongoCollectionTreeItem';
import { getOutputChannel } from './utils/vscodeUtils';

let connectedDb: IAzureParentNode<MongoDatabaseTreeItem> = null;
let languageClient: MongoDBLanguageClient = null;
let explorer: AzureTreeDataProvider;

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Reporter(context));

	const azureAccount = vscode.extensions.getExtension<AzureAccount>('ms-vscode.azure-account')!.exports;

	languageClient = new MongoDBLanguageClient(context);

	let graphViewsManager = new GraphViewsManager(context);
	context.subscriptions.push(this.graphView);

	explorer = new AzureTreeDataProvider(new CosmosDBAccountProvider(), 'cosmosDB.loadMore', [new AttachedAccountsTreeItem(context.globalState)]);
	context.subscriptions.push(explorer);
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cosmosDBExplorer', explorer));

	const editorManager: CosmosEditorManager = new CosmosEditorManager();
	context.subscriptions.push(editorManager);

	context.subscriptions.push(vscodeUtil.getOutputChannel());

	const actionHandler: AzureActionHandler = new AzureActionHandler(context, getOutputChannel(), reporter);
	// Commands
	actionHandler.registerCommand('cosmosDB.createAccount', async (node?: IAzureParentNode) => {
		if (!node) {
			node = <IAzureParentNode>await explorer.showNodePicker(AzureTreeDataProvider.subscriptionContextValue);
		}

		await node.createChild();
	});
	actionHandler.registerCommand('cosmosDB.attachDatabaseAccount', async () => {
		const rootNodes = await explorer.getChildren();
		const attachedDatabasesNode = <IAzureParentNode<AttachedAccountsTreeItem>>rootNodes.find((node) => node.treeItem instanceof AttachedAccountsTreeItem);
		if (attachedDatabasesNode) {
			await attachedDatabasesNode.treeItem.attachNewAccount();
			explorer.refresh(attachedDatabasesNode);
		}
	});
	actionHandler.registerCommand('cosmosDB.attachEmulator', async () => {
		const rootNodes = await explorer.getChildren();
		const attachedDatabasesNode = <IAzureParentNode<AttachedAccountsTreeItem>>rootNodes.find((node) => node.treeItem instanceof AttachedAccountsTreeItem);
		if (attachedDatabasesNode) {
			await attachedDatabasesNode.treeItem.attachEmulator();
			explorer.refresh(attachedDatabasesNode);
		}
	});
	actionHandler.registerCommand('cosmosDB.refresh', (node: IAzureNode) => explorer.refresh(node));
	actionHandler.registerCommand('cosmosDB.detachDatabaseAccount', async (node: IAzureNode) => {
		const attachedNode = <IAzureParentNode<AttachedAccountsTreeItem>>node.parent;
		if (attachedNode) {
			await attachedNode.treeItem.detach(node.treeItem.id);
			explorer.refresh(attachedNode);
		}
	});
	actionHandler.registerCommand('cosmosDB.createMongoDatabase', async (node: IAzureParentNode) => {
		const childNode = await node.createChild();
		await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode);
	});
	actionHandler.registerCommand('cosmosDB.createMongoCollection', async (node: IAzureParentNode<MongoDatabaseTreeItem>) => {
		const childNode = await node.createChild();
		await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode.parent);
	});
	actionHandler.registerCommand('cosmosDB.createMongoDocument', (node: IAzureParentNode) => node.createChild());
	actionHandler.registerCommand('cosmosDB.createDocDBDatabase', async (node: IAzureParentNode) => {
		const databaseNode: IAzureParentNode = <IAzureParentNode>await node.createChild();
		await databaseNode.createChild();
	});
	actionHandler.registerCommand('cosmosDB.createGraphDatabase', (node: IAzureParentNode) => node.createChild());
	actionHandler.registerCommand('cosmosDB.createDocDBCollection', (node: IAzureParentNode) => node.createChild());
	actionHandler.registerCommand('cosmosDB.createGraph', (node: IAzureParentNode) => node.createChild());
	actionHandler.registerCommand('cosmosDB.createDocDBDocument', (node: IAzureParentNode) => node.createChild());
	actionHandler.registerCommand('cosmosDB.openInPortal', (node: IAzureNode) => node.openInPortal());
	actionHandler.registerCommand('cosmosDB.copyConnectionString', (node: IAzureNode<MongoAccountTreeItem | DocDBAccountTreeItemBase>) => copyConnectionString(node));

	actionHandler.registerCommand('cosmosDB.connectMongoDB', async (node: IAzureParentNode<MongoDatabaseTreeItem>) => {
		if (connectedDb) {
			connectedDb.treeItem.isConnected = false;
			connectedDb.refresh();
		}
		connectedDb = node;
		await languageClient.connect(connectedDb.treeItem.connectionString);
		connectedDb.treeItem.isConnected = true;
		node.refresh();
	});
	actionHandler.registerCommand('cosmosDB.deleteMongoDB', async (node: IAzureNode<MongoDatabaseTreeItem>) => {
		await node.deleteNode();
		if (connectedDb && connectedDb.treeItem.id === node.treeItem.id) {
			connectedDb = null;
			languageClient.disconnect();
		}
	});
	actionHandler.registerCommand('cosmosDB.deleteMongoCollection', (node: IAzureNode) => node.deleteNode());
	actionHandler.registerCommand('cosmosDB.deleteMongoDocument', (node: IAzureNode) => node.deleteNode());
	actionHandler.registerCommand('cosmosDB.deleteDocDBDatabase', (node: IAzureNode) => node.deleteNode());
	actionHandler.registerCommand('cosmosDB.deleteDocDBCollection', (node: IAzureNode) => node.deleteNode());
	actionHandler.registerCommand('cosmosDB.deleteDocDBDocument', (node: IAzureNode) => node.deleteNode());
	actionHandler.registerCommand('cosmosDB.deleteGraphDatabase', (node: IAzureNode) => node.deleteNode());
	actionHandler.registerCommand('cosmosDB.deleteGraph', (node: IAzureNode) => node.deleteNode());
	actionHandler.registerCommand('cosmosDB.openDocument', async (node: IAzureNode) => {
		if (node.treeItem instanceof MongoDocumentTreeItem) {
			await editorManager.showDocument(new MongoDocumentNodeEditor(<IAzureNode<MongoDocumentTreeItem>>node), 'cosmos-document.json');
		} else if (node.treeItem instanceof DocDBDocumentTreeItem) {
			await editorManager.showDocument(new DocDBDocumentNodeEditor(<IAzureNode<DocDBDocumentTreeItem>>node), 'cosmos-document.json');
		}
	});
	actionHandler.registerCommand('cosmosDB.openCollection', (node: IAzureParentNode<MongoCollectionTreeItem>) => editorManager.showDocument(new MongoCollectionNodeEditor(node), 'cosmos-collection.json'));
	actionHandler.registerCommand('cosmosDB.newMongoScrapbook', async () => await vscodeUtil.showNewFile('', context.extensionPath, 'Scrapbook', '.mongo'));
	actionHandler.registerCommand('cosmosDB.executeMongoCommand', async () => await MongoCommands.executeCommandFromActiveEditor(connectedDb, context.extensionPath, editorManager));
	actionHandler.registerCommand('cosmosDB.update', (filePath: string) => editorManager.updateMatchingNode(filePath));
	actionHandler.registerCommand('cosmosDB.launchMongoShell', () => launchMongoShell());
	actionHandler.registerCommand('cosmosDB.loadMore', (node: IAzureNode) => explorer.loadMore(node));
	actionHandler.registerCommand('cosmosDB.openGraphExplorer', async (graph: IAzureNode<GraphCollectionTreeItem>) => {
		if (!graph) {
			return; // TODO: Ask for context instead of ignoring (issue#35)
		}
		await graph.treeItem.showExplorer(graphViewsManager);
	});
	actionHandler.registerEvent('cosmosDB.CosmosEditorManager.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument,
		(trackTelemetry: () => void, doc: vscode.TextDocument) => editorManager.onDidSaveTextDocument(trackTelemetry, context.globalState, doc));

}

async function copyConnectionString(node: IAzureNode<MongoAccountTreeItem | DocDBAccountTreeItemBase>) {
	if (node) {
		if (process.platform !== 'linux' || (await cpUtil.commandSucceeds('xclip', '-version'))) {
			copypaste.copy(node.treeItem.connectionString);
		} else {
			vscode.window.showErrorMessage('You must have xclip installed to copy the connection string.');
		}
	}
}

function launchMongoShell() {
	const terminal: vscode.Terminal = vscode.window.createTerminal('Mongo Shell');
	terminal.sendText(`mongo`);
	terminal.show();
}

// this method is called when your extension is deactivated
export function deactivate() {
}
