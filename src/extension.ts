/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as copypaste from 'copy-paste';
import * as opn from 'opn';
import * as util from "./util";

import { AzureAccount } from './azure-account.api';
import { CosmosDBCommands } from './commands';
import { CosmosDBExplorer } from './explorer';
import { MongoCommands } from './mongo/commands';
import { IMongoServer, MongoDatabaseNode, MongoCommand, MongoCollectionNode } from './mongo/nodes';
import { DocDBDatabaseNode, DocDBCollectionNode } from './docdb/nodes';
import { CosmosDBResourceNode, INode } from './nodes'
import MongoDBLanguageClient from './mongo/languageClient';
import { Reporter } from './telemetry';

let connectedDb: MongoDatabaseNode = null;
let languageClient: MongoDBLanguageClient = null;
let explorer: CosmosDBExplorer;
let lastCommand: MongoCommand;

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Reporter(context));

	const azureAccount = vscode.extensions.getExtension<AzureAccount>('ms-vscode.azure-account')!.exports;

	languageClient = new MongoDBLanguageClient(context);

	explorer = new CosmosDBExplorer(azureAccount, context.globalState);
	context.subscriptions.push(azureAccount.onFiltersChanged(() => explorer.refresh()));
	context.subscriptions.push(azureAccount.onStatusChanged(() => explorer.refresh()));
	context.subscriptions.push(azureAccount.onSessionsChanged(() => explorer.refresh()));
	vscode.window.registerTreeDataProvider('cosmosDBExplorer', explorer);

	// Commands
	initAsyncCommand(context, 'cosmosDB.createAccount', async () => {
		const account = await CosmosDBCommands.createCosmosDBAccount(azureAccount);
		if (account) {
			explorer.refresh();
		}
	});
	initAsyncCommand(context, 'cosmosDB.attachMongoServer', () => attachMongoServer());
	initCommand(context, 'cosmosDB.refresh', (node: INode) => explorer.refresh(node));
	initAsyncCommand(context, 'cosmosDB.removeMongoServer', (node: INode) => removeMongoServer(node));
	initAsyncCommand(context, 'cosmosDB.createMongoDatabase', (node: IMongoServer) => createMongoDatabase(node));
	initAsyncCommand(context, 'cosmosDB.createDocDBDatabase', (node: CosmosDBResourceNode) => CosmosDBCommands.createDocDBDatabase(node, explorer));
	initAsyncCommand(context, 'cosmosDB.createDocDBCollection', (node: DocDBDatabaseNode) => CosmosDBCommands.createDocDBCollection(node, explorer));
	initCommand(context, 'cosmosDB.openInPortal', (node: CosmosDBResourceNode) => openInPortal(node));
	initAsyncCommand(context, 'cosmosDB.copyConnectionString', (node: CosmosDBResourceNode) => copyConnectionString(node));

	vscode.window.setStatusBarMessage('Mongo: Not connected');
	initAsyncCommand(context, 'cosmosDB.connectMongoDB', (element: MongoDatabaseNode) => connectToDatabase(element));
	initCommand(context, 'cosmosDB.dropMongoDB', (element: MongoDatabaseNode) => dropDatabase(element));
	initCommand(context, 'cosmosDB.newMongoScrapbook', () => createScrapbook());
	initCommand(context, 'cosmosDB.executeMongoCommand', () => lastCommand = MongoCommands.executeCommandFromActiveEditor(connectedDb));
	initCommand(context, 'cosmosDB.updateMongoDocuments', () => MongoCommands.updateDocuments(connectedDb, lastCommand));
	initCommand(context, 'cosmosDB.openMongoCollection', (collection: MongoCollectionNode) => {
		connectToDatabase(collection.db);
		lastCommand = MongoCommands.getCommand(`db.${collection.label}.find()`);
		MongoCommands.executeCommand(lastCommand, connectedDb).then(result => util.showResult(result));
	});

	initCommand(context, 'cosmosDB.launchMongoShell', () => launchMongoShell());
	initAsyncCommand(context, 'cosmosDB.openDocDBCollection', async (collection: DocDBCollectionNode) => {
		util.showResult(JSON.stringify(await collection.getDocuments(), null, 2));
	});

}

function initCommand(context: vscode.ExtensionContext, commandId: string, callback: (...args: any[]) => any) {
	initAsyncCommand(context, commandId, (...args: any[]) => Promise.resolve(callback(...args)));
}

function initAsyncCommand(context: vscode.ExtensionContext, commandId: string, callback: (...args: any[]) => Promise<any>) {
	context.subscriptions.push(vscode.commands.registerCommand(commandId, async (...args: any[]) => {
		const start = Date.now();
		let result = 'Succeeded';
		let errorData: string = '';

		try {
			await callback(...args);
		} catch (err) {
			result = 'Failed';
			errorData = util.errToString(err);
			vscode.window.showErrorMessage(err);
		} finally {
			const end = Date.now();
			util.sendTelemetry(commandId, { result: result, error: errorData }, { duration: (end - start) / 1000 });
		}
	}));
}

function createScrapbook(): Thenable<void> {
	return new Promise(() => {
		let uri: vscode.Uri = null;
		let count = 1;
		const max = 99999;
		if (vscode.workspace.workspaceFolders) {
			while (count < max) {
				uri = vscode.Uri.file(path.join(vscode.workspace.rootPath, `Scrapbook-${count}.mongo`));
				if (!vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === uri.fsPath) && !fs.existsSync(uri.fsPath)) {
					break;
				}
				count++;
			}
			if (count === max) {
				vscode.window.showErrorMessage('Could not create new scrapbook.');
				return;
			}
			uri = uri.with({ scheme: 'untitled' });
			vscode.workspace.openTextDocument(uri).then(textDocument => vscode.window.showTextDocument(textDocument));
		}
		else {
			vscode.workspace.openTextDocument({ language: 'mongo' }).then(textDocument => vscode.window.showTextDocument(textDocument));
		}

	});
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


function openInPortal(node: CosmosDBResourceNode) {
	if (node) {
		const portalLink = `https://portal.azure.com/${node.tenantId}/#resource${node.id}`;
		opn(portalLink);
	}
}

async function copyConnectionString(node: IMongoServer) {
	if (node) {
		const connectionString = await node.getConnectionString();
		copypaste.copy(connectionString);
	}
}

async function removeMongoServer(node: INode) {
	const deletedNodes = await explorer.attachedServersNode.remove(node);
	if (deletedNodes) {
		explorer.refresh(explorer.attachedServersNode);
	}
}

function dropDatabase(database: MongoDatabaseNode): void {
	vscode.window.showInformationMessage('Are you sure you want to drop the database \'' + database.id + '\' and its collections?', { modal: true }, 'Drop')
		.then(result => {
			if (result === 'Drop') {
				if (connectedDb && connectedDb.server.id === database.server.id && connectedDb.id === database.id) {
					connectedDb = null;
					languageClient.disconnect();
					vscode.window.setStatusBarMessage('Mongo: Not connected');
				}
				database.drop();
				explorer.refresh(database.server);
			}
		})
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