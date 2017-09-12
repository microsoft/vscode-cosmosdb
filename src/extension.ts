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

import { AzureAccount, AzureSession } from './azure-account.api';
import { CosmosDBCommands } from './commands';
import { CosmosDBExplorer } from './explorer';
import { MongoCommands } from './mongo/commands';
import { IMongoServer, MongoDatabaseNode, MongoCommand, MongoCollectionNode } from './mongo/nodes';
import { CosmosDBResourceNode, INode } from './nodes'
import MongoDBLanguageClient from './mongo/languageClient';

let connectedDb: MongoDatabaseNode = null;
let languageClient: MongoDBLanguageClient = null;
let explorer: CosmosDBExplorer;
let lastCommand: MongoCommand;

export function activate(context: vscode.ExtensionContext) {
	const azureAccount = vscode.extensions.getExtension<AzureAccount>('ms-vscode.azure-account')!.exports;

	languageClient = new MongoDBLanguageClient(context);

	explorer = new CosmosDBExplorer(azureAccount, context.globalState);
	context.subscriptions.push(azureAccount.onFiltersChanged(() => explorer.refresh()));
	context.subscriptions.push(azureAccount.onStatusChanged(() => explorer.refresh()));
	context.subscriptions.push(azureAccount.onSessionsChanged(() => explorer.refresh()));
	vscode.window.registerTreeDataProvider('cosmosDBExplorer', explorer);

	// Commands
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.createAccount', async () => {
		const account = await CosmosDBCommands.createCosmosDBAccount(azureAccount);
		if (account) {
			explorer.refresh();
		}
	}));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.attachMongoServer', () => attachMongoServer()));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.refresh', (node: INode) => explorer.refresh(node)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.removeMongoServer', (node: INode) => removeMongoServer(node)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.createMongoDatabase', (node: IMongoServer) => createMongoDatabase(node)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.openInPortal', (node: CosmosDBResourceNode) => openInPortal(node)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.copyConnectionString', (node: CosmosDBResourceNode) => copyConnectionString(node)));

	vscode.window.setStatusBarMessage('Mongo: Not connected');
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.connectMongoDB', (element: MongoDatabaseNode) => connectToDatabase(element)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.dropMongoDB', (element: MongoDatabaseNode) => dropDatabase(element)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.newMongoScrapbook', () => createScrapbook()));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.executeMongoCommand', () => lastCommand = MongoCommands.executeCommandFromActiveEditor(connectedDb)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.updateMongoDocuments', () => MongoCommands.updateDocuments(connectedDb, lastCommand)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.openMongoCollection', (collection: MongoCollectionNode) => {
		connectToDatabase(collection.db);
		lastCommand = MongoCommands.getCommand(`db.${collection.label}.find()`);
		MongoCommands.executeCommand(lastCommand, connectedDb).then(result => MongoCommands.showResult(result));
	}));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.launchMongoShell', () => launchMongoShell()));
}

function createScrapbook(): Thenable<void> {
	return new Promise(() => {
		let uri: vscode.Uri = null;
		let count = 1;
		const max = 99999;
		if (!vscode.workspace.workspaceFolders){
			vscode.window.showWarningMessage("No open workspace!");
		}
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
	});
}

async function attachMongoServer() {
	const result = await vscode.window.showInputBox({ placeHolder: 'mongodb://host:port' });
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
			prompt: 'A collection is required to create a database'
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