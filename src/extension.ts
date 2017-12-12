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
import { CosmosDBCommands } from './commands';
import { AzureTreeDataProvider, IAzureNode, IAzureParentNode, UserCancelledError } from 'vscode-azureextensionui';
import { MongoCommands } from './mongo/commands';
import { DocDBAccountTreeItemBase } from './docdb/tree/DocDBAccountTreeItemBase';
import MongoDBLanguageClient from './mongo/languageClient';
import { Reporter, callWithTelemetry } from './utils/telemetry';
import { CosmosEditorManager } from './CosmosEditorManager';
import { GraphViewsManager } from "./graph/GraphViewsManager";
import { CosmosDBAccountProvider } from './tree/CosmosDBAccountProvider';
import { AttachedServersTreeItem } from './tree/AttachedServersTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { GraphCollectionTreeItem } from './graph/tree/GraphCollectionTreeItem';
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { MongoDocumentNodeEditor } from './mongo/editors/MongoDocumentNodeEditor';
import { MongoCollectionNodeEditor } from './mongo/editors/MongoCollectionNodeEditor';
import { DocDBDocumentNodeEditor } from './docdb/editors/DocDBDocumentNodeEditor';
import { MongoDatabaseTreeItem } from './mongo/tree/MongoDatabaseTreeItem';
import { MongoCollectionTreeItem } from './mongo/tree/MongoCollectionTreeItem';

let connectedDb: IAzureParentNode<MongoDatabaseTreeItem> = null;
let languageClient: MongoDBLanguageClient = null;
let explorer: AzureTreeDataProvider;

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Reporter(context));

	const azureAccount = vscode.extensions.getExtension<AzureAccount>('ms-vscode.azure-account')!.exports;

	languageClient = new MongoDBLanguageClient(context);

	let graphViewsManager = new GraphViewsManager(context);
	context.subscriptions.push(this.graphView);

	explorer = new AzureTreeDataProvider(new CosmosDBAccountProvider(), 'cosmosDB.loadMore', [new AttachedServersTreeItem(context.globalState)]);
	context.subscriptions.push(explorer);
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cosmosDBExplorer', explorer));

	const editorManager: CosmosEditorManager = new CosmosEditorManager();
	context.subscriptions.push(editorManager);

	context.subscriptions.push(vscodeUtil.getOutputChannel());

	// Commands
	initAsyncCommand(context, 'cosmosDB.createAccount', async () => {
		const account = await CosmosDBCommands.createCosmosDBAccount(azureAccount);
		if (account) {
			explorer.refresh();
		}
	});
	initAsyncCommand(context, 'cosmosDB.attachMongoServer', async () => {
		const rootNodes = await explorer.getChildren();
		const attachedNode = <IAzureParentNode<AttachedServersTreeItem>>rootNodes.find((node) => node.treeItem instanceof AttachedServersTreeItem);
		if (attachedNode) {
			await attachedNode.treeItem.attachNewServer();
			explorer.refresh(attachedNode);
		}
	});
	initCommand(context, 'cosmosDB.refresh', (node: IAzureNode) => explorer.refresh(node));
	initAsyncCommand(context, 'cosmosDB.removeMongoServer', async (node: IAzureNode) => {
		const attachedNode = <IAzureParentNode<AttachedServersTreeItem>>node.parent;
		if (attachedNode) {
			await attachedNode.treeItem.detach(node.treeItem.id);
			explorer.refresh(attachedNode);
		}
	});
	initAsyncCommand(context, 'cosmosDB.createMongoDatabase', async (node: IAzureParentNode) => {
		const childNode = await node.createChild();
		await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode);
	});
	initAsyncCommand(context, 'cosmosDB.createMongoCollection', async (node: IAzureParentNode<MongoDatabaseTreeItem>) => {
		const childNode = await node.createChild();
		await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode.parent);
	});
	initAsyncCommand(context, 'cosmosDB.createMongoDocument', (node: IAzureParentNode) => node.createChild());
	initAsyncCommand(context, 'cosmosDB.createDocDBDatabase', async (node: IAzureParentNode) => {
		const databaseNode: IAzureParentNode = <IAzureParentNode>await node.createChild();
		await databaseNode.createChild();
	});
	initAsyncCommand(context, 'cosmosDB.createGraphDatabase', (node: IAzureParentNode) => node.createChild());
	initAsyncCommand(context, 'cosmosDB.createDocDBCollection', (node: IAzureParentNode) => node.createChild());
	initAsyncCommand(context, 'cosmosDB.createGraph', (node: IAzureParentNode) => node.createChild());
	initAsyncCommand(context, 'cosmosDB.createDocDBDocument', (node: IAzureParentNode) => node.createChild());
	initCommand(context, 'cosmosDB.openInPortal', (node: IAzureNode) => node.openInPortal());
	initAsyncCommand(context, 'cosmosDB.copyConnectionString', (node: IAzureNode<MongoAccountTreeItem | DocDBAccountTreeItemBase>) => copyConnectionString(node));

	vscode.window.setStatusBarMessage('Mongo: Not connected');
	initAsyncCommand(context, 'cosmosDB.connectMongoDB', async (node: IAzureParentNode<MongoDatabaseTreeItem>) => {
		connectedDb = node;
		await languageClient.connect(connectedDb.treeItem.connectionString);
		vscode.window.setStatusBarMessage('Mongo: ' + node.parent.treeItem.label + '/' + connectedDb.treeItem.label);
	});
	initAsyncCommand(context, 'cosmosDB.deleteMongoDB', async (node: IAzureNode<MongoDatabaseTreeItem>) => {
		await node.deleteNode();
		if (connectedDb && connectedDb.treeItem.id === node.treeItem.id) {
			connectedDb = null;
			languageClient.disconnect();
			vscode.window.setStatusBarMessage('Mongo: Not connected');
		}
	});
	initAsyncCommand(context, 'cosmosDB.deleteMongoCollection', (node: IAzureNode) => node.deleteNode());
	initAsyncCommand(context, 'cosmosDB.deleteMongoDocument', (node: IAzureNode) => node.deleteNode());
	initAsyncCommand(context, 'cosmosDB.deleteDocDBDatabase', (node: IAzureNode) => node.deleteNode());
	initAsyncCommand(context, 'cosmosDB.deleteDocDBCollection', (node: IAzureNode) => node.deleteNode());
	initAsyncCommand(context, 'cosmosDB.deleteDocDBDocument', (node: IAzureNode) => node.deleteNode());
	initAsyncCommand(context, 'cosmosDB.deleteGraphDatabase', (node: IAzureNode) => node.deleteNode());
	initAsyncCommand(context, 'cosmosDB.deleteGraph', (node: IAzureNode) => node.deleteNode());
	initAsyncCommand(context, 'cosmosDB.openDocument', async (node: IAzureNode) => {
		if (node.treeItem instanceof MongoDocumentTreeItem) {
			await editorManager.showDocument(new MongoDocumentNodeEditor(<IAzureNode<MongoDocumentTreeItem>>node), 'cosmos-document.json');
		} else if (node.treeItem instanceof DocDBDocumentTreeItem) {
			await editorManager.showDocument(new DocDBDocumentNodeEditor(<IAzureNode<DocDBDocumentTreeItem>>node), 'cosmos-document.json');
		}
	});
	initAsyncCommand(context, 'cosmosDB.openCollection', (node: IAzureParentNode<MongoCollectionTreeItem>) => editorManager.showDocument(new MongoCollectionNodeEditor(node), 'cosmos-collection.json'));
	initAsyncCommand(context, 'cosmosDB.newMongoScrapbook', async () => await vscodeUtil.showNewFile('', context.extensionPath, 'Scrapbook', '.mongo'));
	initAsyncCommand(context, 'cosmosDB.executeMongoCommand', async () => await MongoCommands.executeCommandFromActiveEditor(connectedDb, context.extensionPath, editorManager));
	initAsyncCommand(context, 'cosmosDB.update', (filePath: string) => editorManager.updateMatchingNode(filePath));
	initCommand(context, 'cosmosDB.launchMongoShell', () => launchMongoShell());
	initAsyncCommand(context, 'cosmosDB.loadMore', (node: IAzureNode) => explorer.loadMore(node));
	initAsyncCommand(context, 'cosmosDB.openGraphExplorer', async (graph: IAzureNode<GraphCollectionTreeItem>) => {
		if (!graph) {
			return; // TODO: Ask for context instead of ignoring (issue#35)
		}
		await graph.treeItem.showExplorer(graphViewsManager);
	});
	initEvent(context, 'cosmosDB.CosmosEditorManager.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument,
		(doc: vscode.TextDocument) => editorManager.onDidSaveTextDocument(context.globalState, doc));

}

function initCommand(context: vscode.ExtensionContext, commandId: string, callback: (...args: any[]) => any) {
	initAsyncCommand(context, commandId, (...args: any[]) => Promise.resolve(callback(...args)));
}

function initEvent<T>(context: vscode.ExtensionContext, eventId: string, event: vscode.Event<T>, callback: (...args: any[]) => any) {
	context.subscriptions.push(event(wrapAsyncCallback(eventId, (...args: any[]) => Promise.resolve(callback(...args)))));
}

function initAsyncCommand(context: vscode.ExtensionContext, commandId: string, callback: (...args: any[]) => Promise<any>) {
	context.subscriptions.push(vscode.commands.registerCommand(commandId, wrapAsyncCallback(commandId, callback)));
}

function wrapAsyncCallback(callbackId, callback: (...args: any[]) => Promise<any>): (...args: any[]) => Promise<any> {
	return async (...args: any[]) => {
		const output = vscodeUtil.getOutputChannel();

		try {
			await callWithTelemetry(callbackId, (telemetryProperties, measurements) => callback(...args));
		} catch (err) {
			if (!(err instanceof UserCancelledError)) {
				let errorData = new ErrorData(err);
				output.appendLine(errorData.message);
				if (errorData.message.includes("\n")) {
					output.show();
					vscode.window.showErrorMessage('An error has occured. See output window for more details.');
				}
				else {
					vscode.window.showErrorMessage(errorData.message);
				}
			}
		}
	};
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
