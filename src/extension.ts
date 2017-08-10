/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { MongoExplorer } from './mongo/explorer';
import { MongoCommands } from './mongo/commands';
import { Model, Database, Server, IMongoResource, MongoCommand, Collection } from './mongo/mongo';
import MongoDBLanguageClient from './mongo/languageClient';

let connectedDb: Database = null;
let languageClient: MongoDBLanguageClient = null;
let model: Model;
let lastCommand: MongoCommand;

export function activate(context: vscode.ExtensionContext) {
	// Create the storage folder
	if (context.storagePath) {
		createStorageFolder(context).then(() => {
			languageClient = new MongoDBLanguageClient(context);
			model = new Model(context.storagePath);

			// Mongo Tree View
			const explorer = new MongoExplorer(model, context);
			vscode.window.registerTreeDataProvider('mongoExplorer', explorer);

			// Commands
			context.subscriptions.push(vscode.commands.registerCommand('mongo.addServer', () => addServer()));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.refreshExplorer', () => explorer.refresh()));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.removeServer', (element: IMongoResource) => model.remove(element)));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.createDatabase', (server: Server) => createDatabase(server)));

			vscode.window.setStatusBarMessage('Mongo: Not connected');
			context.subscriptions.push(vscode.commands.registerCommand('mongo.connect', (element: Database) => connectToDatabase(element)));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.dropDb', (element: Database) => dropDatabase(element)));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.connectDb', () => {
				vscode.window.showQuickPick(getDatabaseQuickPicks()).then(pick => connectToDatabase(pick.database));
			}));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.newScrapbook', () => createScrapbook()));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.executeCommand', () => lastCommand = MongoCommands.executeCommandFromActiveEditor(connectedDb)));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.updateDocuments', () => MongoCommands.updateDocuments(connectedDb, lastCommand)));
			context.subscriptions.push(vscode.commands.registerCommand('mongo.openCollection', (collection: Collection) => {
				connectToDatabase(collection.db);
				lastCommand = MongoCommands.getCommand(`db.${collection.label}.find()`);
				MongoCommands.executeCommand(lastCommand, connectedDb).then(result => MongoCommands.showResult(result));
			}));
		});
	}
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

function connectToDatabase(database: Database): void {
	connectedDb = database;
	languageClient.connect(database);
	vscode.window.setStatusBarMessage('Mongo: ' + database.server.label + '/' + connectedDb.id);
}

async function createStorageFolder(context: vscode.ExtensionContext): Promise<void> {
	return new Promise<void>((c, e) => {
		fs.exists(context.storagePath, exists => {
			if (exists) {
				c(null);
			} else {
				fs.mkdir(context.storagePath, error => {
					c(null);
				})
			}
		});
	})
}

// this method is called when your extension is deactivated
export function deactivate() {
}