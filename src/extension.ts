/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as _ from 'underscore';
import * as fs from 'fs';
import * as path from 'path';
import * as copypaste from 'copy-paste';
import * as opn from 'opn';
import * as util from "./util";
import * as cpUtil from './utils/cp';

import { AzureAccount } from './azure-account.api';
import { ErrorData } from './ErrorData';
import { CosmosDBCommands } from './commands';
import { CosmosDBExplorer } from './explorer';
import { MongoCommands } from './mongo/commands';
import { IMongoServer, MongoDatabaseNode, MongoCommand, MongoCollectionNode, MongoDocumentNode } from './mongo/nodes';
import { DocDBDatabaseNode, DocDBCollectionNode, DocDBDocumentNode } from './docdb/nodes';
import { CosmosDBAccountNode, INode, IEditableNode, LoadMoreNode } from './nodes';
import { DocumentClient } from 'documentdb';
import { GraphNode, GraphDatabaseNode } from './graph/graphNodes';
import MongoDBLanguageClient from './mongo/languageClient';
import { Reporter } from './telemetry';
import { UserCancelledError } from './errors';
import { DocDBCommands } from './docdb/commands';
import { DialogBoxResponses } from './constants'
import { DocumentEditor } from './DocumentEditor';
import { GraphViewsManager } from "./graph/GraphViewsManager";

let connectedDb: MongoDatabaseNode = null;
let languageClient: MongoDBLanguageClient = null;
let explorer: CosmosDBExplorer;
let graphViewsManager: GraphViewsManager;
enum DocumentType {
	Mongo,
	DocDB
};

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Reporter(context));

	const azureAccount = vscode.extensions.getExtension<AzureAccount>('ms-vscode.azure-account')!.exports;

	languageClient = new MongoDBLanguageClient(context);

	let graphViewsManager = new GraphViewsManager(context);
	context.subscriptions.push(this.graphView);

	explorer = new CosmosDBExplorer(azureAccount, context.globalState);
	context.subscriptions.push(azureAccount.onFiltersChanged(() => explorer.refresh()));
	context.subscriptions.push(azureAccount.onStatusChanged(() => explorer.refresh()));
	context.subscriptions.push(azureAccount.onSessionsChanged(() => explorer.refresh()));
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cosmosDBExplorer', explorer));

	const documentEditor: DocumentEditor = new DocumentEditor();
	context.subscriptions.push(documentEditor);

	context.subscriptions.push(util.getOutputChannel());


	// Commands
	initAsyncCommand(context, 'cosmosDB.createAccount', async () => {
		const account = await CosmosDBCommands.createCosmosDBAccount(azureAccount);
		if (account) {
			explorer.refresh();
		}
	});
	initAsyncCommand(context, 'cosmosDB.attachMongoServer', () => attachMongoServer());
	initCommand(context, 'cosmosDB.refresh', (node: INode) => {
		if (node instanceof DocDBCollectionNode || node instanceof MongoCollectionNode) {
			node.clearCache();
		}
		explorer.refresh(node)
	});
	initAsyncCommand(context, 'cosmosDB.removeMongoServer', (node: INode) => removeMongoServer(node));
	initAsyncCommand(context, 'cosmosDB.createMongoDatabase', (node: IMongoServer) => createMongoDatabase(node));
	initAsyncCommand(context, 'cosmosDB.createMongoCollection', async (node: MongoDatabaseNode) => {
		MongoCommands.createMongoCollection(node, explorer);
		connectToDatabase(node);
	});
	initAsyncCommand(context, 'cosmosDB.createDocDBDatabase', (node: CosmosDBAccountNode) => DocDBCommands.createDatabase(node, explorer));
	initAsyncCommand(context, 'cosmosDB.createGraphDatabase', (node: CosmosDBAccountNode) => DocDBCommands.createDatabase(node, explorer));
	initAsyncCommand(context, 'cosmosDB.createMongoDocument', (node: MongoCollectionNode) => MongoCommands.createMongoDocument(node, explorer));
	initAsyncCommand(context, 'cosmosDB.createDocDBCollection', (node: DocDBDatabaseNode) => DocDBCommands.createCollection(node, explorer));
	initAsyncCommand(context, 'cosmosDB.createGraph', (node: GraphDatabaseNode) => DocDBCommands.createCollection(node, explorer));
	initAsyncCommand(context, 'cosmosDB.createDocDBDocument', (node: DocDBCollectionNode) => DocDBCommands.createDocDBDocument(node, explorer));
	initCommand(context, 'cosmosDB.openInPortal', (node: CosmosDBAccountNode) => openInPortal(node));
	initAsyncCommand(context, 'cosmosDB.copyConnectionString', (node: CosmosDBAccountNode) => copyConnectionString(node));

	vscode.window.setStatusBarMessage('Mongo: Not connected');
	initAsyncCommand(context, 'cosmosDB.connectMongoDB', (element: MongoDatabaseNode) => connectToDatabase(element));
	initAsyncCommand(context, 'cosmosDB.deleteMongoDB', (element: MongoDatabaseNode) => deleteDatabase(element));
	initAsyncCommand(context, 'cosmosDB.deleteMongoCollection', (element: MongoCollectionNode) => MongoCommands.deleteMongoCollection(element, explorer));
	initAsyncCommand(context, 'cosmosDB.deleteMongoDocument', (element: MongoDocumentNode) => MongoCommands.deleteMongoDocument(element, explorer));
	initAsyncCommand(context, 'cosmosDB.deleteDocDBDatabase', (element: DocDBDatabaseNode) => DocDBCommands.deleteDatabase(element, explorer));
	initAsyncCommand(context, 'cosmosDB.deleteDocDBCollection', (element: DocDBCollectionNode) => DocDBCommands.deleteCollection(element, explorer));
	initAsyncCommand(context, 'cosmosDB.deleteDocDBDocument', (element: DocDBDocumentNode) => DocDBCommands.deleteDocDBDocument(element, explorer));
	initAsyncCommand(context, 'cosmosDB.deleteGraphDatabase', (element: GraphDatabaseNode) => DocDBCommands.deleteDatabase(element, explorer));
	initAsyncCommand(context, 'cosmosDB.deleteGraph', (element: GraphNode) => DocDBCommands.deleteCollection(element, explorer));
	initAsyncCommand(context, 'cosmosDB.openDocument', async (docNode: IEditableNode) => await documentEditor.showDocument(docNode, 'cosmos-editor.json'));
	initAsyncCommand(context, 'cosmosDB.openCollection', async (collNode: IEditableNode) => await documentEditor.showDocument(collNode, 'cosmos-editor.json'));
	initAsyncCommand(context, 'cosmosDB.newMongoScrapbook', async () => await util.showNewFile('', context.extensionPath, 'Scrapbook', '.mongo'));
	initAsyncCommand(context, 'cosmosDB.executeMongoCommand', async () => await MongoCommands.executeCommandFromActiveEditor(connectedDb, context.extensionPath, documentEditor));
	initAsyncCommand(context, 'cosmosDB.update', (filePath: string) => documentEditor.updateMatchingNode(filePath));
	initCommand(context, 'cosmosDB.launchMongoShell', () => launchMongoShell());
	initAsyncCommand(context, 'cosmosDB.loadMore', async (node: LoadMoreNode) => {
		await node.parentNode.addMoreChildren();
		explorer.refresh(node.parentNode);
	});
	initAsyncCommand(context, 'graph.openExplorer', async (graph: GraphNode) => {
		if (!graph) {
			return; // TODO: Ask for context instead of ignoring (issue#35)
		}
		await graph.showExplorer(graphViewsManager);
	});
	initEvent(context, 'cosmosDB.documentEditor.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument,
		(doc: vscode.TextDocument) => documentEditor.onDidSaveTextDocument(context.globalState, doc));

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
		const start = Date.now();
		let properties: { [key: string]: string; } = {};
		properties.result = 'Succeeded';
		let errorData: ErrorData | undefined = null;
		const output = util.getOutputChannel();

		try {
			await callback(...args);
		} catch (err) {
			if (err instanceof UserCancelledError) {
				properties.result = 'Canceled';
			}
			else {
				properties.result = 'Failed';
				errorData = new ErrorData(err);
				output.appendLine(errorData.message);
				if (errorData.message.includes("\n")) {
					output.show();
					vscode.window.showErrorMessage('An error has occured. See output window for more details.');
				}
				else {
					vscode.window.showErrorMessage(errorData.message);
				}
			}
		} finally {
			if (errorData) {
				properties.error = errorData.errorType;
				properties.errorMessage = errorData.message;
			}
			const end = Date.now();
			util.sendTelemetry(callbackId, properties, { duration: (end - start) / 1000 });
		}
	};
}

async function attachMongoServer() {
	const result = await vscode.window.showInputBox({
		placeHolder: 'mongodb://host:port',
		ignoreFocusOut: true
	});
	if (result) {
		const insertedNode = await explorer.attachedServersNode.attach(result);
		if (insertedNode) {
			explorer.refresh(explorer.attachedServersNode);
		}
	}
}

async function createMongoDatabase(server: IMongoServer) {
	const databaseName = await vscode.window.showInputBox({ placeHolder: 'Database Name' });
	if (databaseName) {
		const collectionName = await vscode.window.showInputBox({
			placeHolder: 'Collection Name',
			prompt: 'A collection is required to create a database',
			ignoreFocusOut: true
		});
		if (collectionName) {
			const databaseNode = new MongoDatabaseNode(databaseName, server);
			await databaseNode.createCollection(collectionName);
			explorer.refresh(server);
			connectToDatabase(databaseNode);
		}
	}
}


function openInPortal(node: CosmosDBAccountNode) {
	if (node) {
		const portalLink = `https://portal.azure.com/${node.tenantId}/#resource${node.id}`;
		opn(portalLink);
	}
}

async function copyConnectionString(node: IMongoServer) {
	if (node) {
		if (process.platform !== 'linux' || (await cpUtil.commandSucceeds('xclip', '-version'))) {
			const connectionString = await node.getConnectionString();
			copypaste.copy(connectionString);
		} else {
			vscode.window.showErrorMessage('You must have xclip installed to copy the connection string.');
		}
	}
}

async function removeMongoServer(node: INode) {
	const deletedNodes = await explorer.attachedServersNode.remove(node);
	if (deletedNodes) {
		explorer.refresh(explorer.attachedServersNode);
	}
}

async function deleteDatabase(database: MongoDatabaseNode): Promise<void> {
	if (database) {
		const confirmed = await vscode.window.showWarningMessage(`Are you sure you want to delete database ${database.id} and its collections?`, DialogBoxResponses.Yes, DialogBoxResponses.No);
		if (confirmed === DialogBoxResponses.Yes) {
			if (connectedDb && connectedDb.server.id === database.server.id && connectedDb.id === database.id) {
				connectedDb = null;
				languageClient.disconnect();
				vscode.window.setStatusBarMessage('Mongo: Not connected');
			}
			database.drop();
			explorer.refresh(database.server);
		}
	}
}

async function connectToDatabase(database: MongoDatabaseNode) {
	if (database) {
		connectedDb = database;
		languageClient.connect(database);
		vscode.window.setStatusBarMessage('Mongo: ' + database.server.label + '/' + connectedDb.id);
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
