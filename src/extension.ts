/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { AzureAccount, AzureSession } from './azure-account.api';
import { MongoExplorer } from './mongo/explorer';
import { MongoCommands } from './mongo/commands';
import { Model, Database, Server, IMongoResource, MongoCommand, Collection } from './mongo/mongo';
import MongoDBLanguageClient from './mongo/languageClient';

let connectedDb: Database = null;
let languageClient: MongoDBLanguageClient = null;
let model: Model;
let lastCommand: MongoCommand;

export function activate(context: vscode.ExtensionContext) {
	const azureAccount = vscode.extensions.getExtension<AzureAccount>('vscode.azure-account')!.exports;

	languageClient = new MongoDBLanguageClient(context);

	model = new Model(azureAccount);
	context.subscriptions.push(azureAccount.onFiltersChanged(() => model.refreshAzureResources()));
	context.subscriptions.push(azureAccount.onStatusChanged(() => model.refreshAzureResources()));
	context.subscriptions.push(azureAccount.onSessionsChanged(() => model.refreshAzureResources()));

	// Mongo Tree View
	const explorer = new MongoExplorer(model);
	vscode.window.registerTreeDataProvider('cosmosDBExplorer', explorer);

	// Commands
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.addMongoServer', () => addServer()));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.refreshExplorer', () => model.refreshAzureResources()));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.removeMongoServer', (element: IMongoResource) => model.remove(element)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.createMongoDatabase', (server: Server) => createDatabase(server)));

	vscode.window.setStatusBarMessage('Mongo: Not connected');
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.connectMongoDB', (element: Database) => connectToDatabase(element)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.dropMongoDB', (element: Database) => dropDatabase(element)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.newMongoScrapbook', () => createScrapbook()));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.executeMongoCommand', () => lastCommand = MongoCommands.executeCommandFromActiveEditor(connectedDb)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.updateMongoDocuments', () => MongoCommands.updateDocuments(connectedDb, lastCommand)));
	context.subscriptions.push(vscode.commands.registerCommand('cosmosDB.openMongoCollection', (collection: Collection) => {
		connectToDatabase(collection.db);
		lastCommand = MongoCommands.getCommand(`db.${collection.label}.find()`);
		MongoCommands.executeCommand(lastCommand, connectedDb).then(result => MongoCommands.showResult(result));
	}));
}

function createScrapbook(): Thenable<void> {
	return new Promise(() => {
		let uri: vscode.Uri = null;
		let count = 1;
		const max = 99999;
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

function addServer(): void {
	vscode.window.showInputBox({
		placeHolder: 'mongodb://host:port'
	}).then(value => {
		if (value) {
			model.add(value);
		}
	});
}

function createDatabase(server: Server): void {
	vscode.window.showInputBox({
		placeHolder: 'Database Name'
	}).then(database => {
		if (database) {
			vscode.window.showInputBox({
				placeHolder: 'Collection Name',
				prompt: 'A collection is must to create a database'
			}).then(collection => {
				if (collection) {
					server.createDatabase(database, collection)
						.then(database => connectToDatabase(database));
				}
			})
		}
	});
}

class DatabaseQuickPick implements vscode.QuickPickItem {
	readonly label: string;
	readonly description: string;
	constructor(readonly database: Database) {
		this.label = database.label;
		this.description = database.server.label + '/' + database.label;
	}
}

function getDatabaseQuickPicks(): Thenable<DatabaseQuickPick[]> {
	const quickPicks: DatabaseQuickPick[] = [];
	return model.getChildren().then(servers => {
		return Promise.all(servers.map(server => server.getChildren()))
			.then(allDatabases => {
				allDatabases.forEach(databases => {
					quickPicks.push(...databases.map(database => new DatabaseQuickPick(<Database>database)));
				});
				return quickPicks;
			})
	});
}

function dropDatabase(database: Database): void {
	vscode.window.showInformationMessage('Are you sure you want to drop the database \'' + database.id + '\' and its collections?', { modal: true }, 'Drop')
		.then(result => {
			if (result === 'Drop') {
				if (connectedDb && connectedDb.server.id === database.server.id && connectedDb.id === database.id) {
					connectedDb = null;
					languageClient.disconnect();
					vscode.window.setStatusBarMessage('Mongo: Not connected');
				}
				database.server.dropDb(database);
			}
		})
}

async function connectToDatabase(database: Database) {
	if (!database) {
		const pick = await vscode.window.showQuickPick(getDatabaseQuickPicks());
		if (!pick) {
			return;
		}
		
		database = pick.database;
	}

	connectedDb = database;
	languageClient.connect(database);
	vscode.window.setStatusBarMessage('Mongo: ' + database.server.label + '/' + connectedDb.id);
}

// this method is called when your extension is deactivated
export function deactivate() {
}