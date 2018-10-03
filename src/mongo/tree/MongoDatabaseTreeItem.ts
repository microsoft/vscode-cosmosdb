/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import { Collection, Db } from 'mongodb';
import opn = require('opn');
import * as path from 'path';
import * as process from 'process';
import * as vscode from 'vscode';
import { appendExtensionUserAgent, DialogResponses, IActionContext, IAzureNode, IAzureParentTreeItem, IAzureTreeItem, UserCancelledError } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import * as cpUtils from '../../utils/cp';
import { connectToMongoClient } from '../connectToMongoClient';
import { MongoCommand } from '../MongoCommand';
import { Shell } from '../shell';
import { MongoCollectionTreeItem } from './MongoCollectionTreeItem';

const mongoExecutableFileName = process.platform === 'win32' ? 'mongo.exe' : 'mongo';

export class MongoDatabaseTreeItem implements IAzureParentTreeItem {
	public static contextValue: string = "mongoDb";
	public readonly contextValue: string = MongoDatabaseTreeItem.contextValue;
	public readonly childTypeLabel: string = "Collection";
	public readonly connectionString: string;
	public readonly isEmulator: boolean;
	public readonly databaseName: string;

	private _parentId: string;
	private _previousShellPathSetting: string | undefined;
	private _cachedShellPathOrCmd: string | undefined;

	constructor(databaseName: string, connectionString: string, isEmulator: boolean, parentId: string) {
		this.databaseName = databaseName;
		this.connectionString = connectionString;
		this.isEmulator = isEmulator;
		this._parentId = parentId;
	}

	public get label(): string {
		return this.databaseName;
	}

	public get description(): string {
		return ext.connectedMongoDB && ext.connectedMongoDB.id === `${this._parentId}/${this.id}` ? 'Connected' : '';
	}

	public get id(): string {
		return this.databaseName;
	}

	public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
		return {
			light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Database.svg'),
			dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Database.svg')
		};
	}

	public hasMoreChildren(): boolean {
		return false;
	}

	public async loadMoreChildren(_node: IAzureNode, _clearCache: boolean): Promise<IAzureTreeItem[]> {
		const db: Db = await this.getDb();
		const collections: Collection[] = await db.collections();
		return collections.map(collection => new MongoCollectionTreeItem(collection));
	}

	public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
		const collectionName = await vscode.window.showInputBox({
			placeHolder: "Collection Name",
			prompt: "Enter the name of the collection",
			validateInput: validateMongoCollectionName,
			ignoreFocusOut: true
		});

		if (collectionName) {
			showCreatingNode(collectionName);
			return await this.createCollection(collectionName);
		}

		throw new UserCancelledError();
	}

	public async deleteTreeItem(_node: IAzureNode): Promise<void> {
		const message: string = `Are you sure you want to delete database '${this.label}'?`;
		const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
		if (result === DialogResponses.deleteResponse) {
			const db = await this.getDb();
			await db.dropDatabase();
		} else {
			throw new UserCancelledError();
		}
	}

	public async getDb(): Promise<Db> {
		const accountConnection = await connectToMongoClient(this.connectionString, appendExtensionUserAgent());
		return accountConnection.db(this.databaseName);
	}

	async executeCommand(command: MongoCommand, context: IActionContext): Promise<string> {
		if (command.collection) {
			let db = await this.getDb();
			const collection = db.collection(command.collection);
			if (collection) {
				const collectionTreeItem = new MongoCollectionTreeItem(collection, command.arguments);
				const result = await collectionTreeItem.executeCommand(command.name, command.arguments);
				if (result) {
					return result;
				}
			}
			return withProgress(this.executeCommandInShell(command, context), 'Executing command');

		}

		if (command.name === 'createCollection') {
			return withProgress(this.createCollection(stripQuotes(command.arguments.join(','))).then(() => JSON.stringify({ 'Created': 'Ok' })), 'Creating collection');
		} else {
			return withProgress(this.executeCommandInShell(command, context), 'Executing command');
		}
	}

	async createCollection(collectionName: string): Promise<MongoCollectionTreeItem> {
		const db: Db = await this.getDb();
		const newCollection: Collection = db.collection(collectionName);
		// db.createCollection() doesn't create empty collections for some reason
		// However, we can 'insert' and then 'delete' a document, which has the side-effect of creating an empty collection
		const result = await newCollection.insertOne({});
		await newCollection.deleteOne({ _id: result.insertedId });
		return new MongoCollectionTreeItem(newCollection);
	}

	executeCommandInShell(command: MongoCommand, context: IActionContext): Thenable<string> {
		context.properties["executeInShell"] = "true";
		return this.getShell().then(shell => shell.exec(command.text));
	}

	private async getShell(): Promise<Shell> {
		let shellPathSetting: string | undefined = vscode.workspace.getConfiguration().get(ext.settingsKeys.mongoShellPath);
		if (!this._cachedShellPathOrCmd || this._previousShellPathSetting !== shellPathSetting) {
			// Only do this if setting changed since last time
			this._previousShellPathSetting = shellPathSetting;
			await this._determineShellPathOrCmd(shellPathSetting);
		}

		return await this.createShell(this._cachedShellPathOrCmd);
	}

	private async _determineShellPathOrCmd(shellPathSetting: string): Promise<void> {
		this._cachedShellPathOrCmd = shellPathSetting;
		if (!shellPathSetting) {
			// User hasn't specified the path
			if (await cpUtils.commandSucceeds('mongo', '--version')) {
				// If the user already has mongo in their system path, just use that
				this._cachedShellPathOrCmd = 'mongo';
			} else {
				// If all else fails, prompt the user for the mongo path

				// tslint:disable-next-line:no-constant-condition
				const openFile: vscode.MessageItem = { title: `Browse to ${mongoExecutableFileName}` };
				const browse: vscode.MessageItem = { title: 'Open installation page' };
				let response = await vscode.window.showErrorMessage('This functionality requires the Mongo DB shell.', browse, openFile);
				if (response === openFile) {
					// tslint:disable-next-line:no-constant-condition
					while (true) {
						let newPath: vscode.Uri[] = await vscode.window.showOpenDialog({
							filters: { 'Executable Files': [process.platform === 'win32' ? 'exe' : ''] },
							openLabel: `Select ${mongoExecutableFileName}`
						});
						if (newPath && newPath.length) {
							let fsPath = newPath[0].fsPath;
							let baseName = path.basename(fsPath);
							if (baseName !== mongoExecutableFileName) {
								const useAnyway: vscode.MessageItem = { title: 'Use anyway' };
								const tryAgain: vscode.MessageItem = { title: 'Try again' };
								let response2 = await ext.ui.showWarningMessage(
									`Expected a file named "${mongoExecutableFileName}, but the selected filename is "${baseName}"`,
									useAnyway,
									tryAgain);
								if (response2 === tryAgain) {
									continue;
								}
							}

							this._cachedShellPathOrCmd = fsPath;
							await vscode.workspace.getConfiguration().update(ext.settingsKeys.mongoShellPath, this._cachedShellPathOrCmd, vscode.ConfigurationTarget.Global);
							return;
						}
					}
				} else if (response === browse) {
					this._cachedShellPathOrCmd = undefined;
					opn('https://docs.mongodb.com/manual/installation/');
				}

				throw new UserCancelledError();
			}
		} else {
			// User has specified the path or command.  Sometimes they set the folder instead of a path to the file, let's check that and auto fix
			if (await fse.pathExists(shellPathSetting)) {
				let stat = await fse.stat(shellPathSetting);
				if (stat.isDirectory()) {
					this._cachedShellPathOrCmd = path.join(shellPathSetting, mongoExecutableFileName);
				}
			}
		}
	}

	private async createShell(shellPath: string): Promise<Shell> {
		return <Promise<null>>Shell.create(shellPath, this.connectionString, this.isEmulator)
			.then(
				shell => {
					return shell.useDatabase(this.databaseName).then(() => shell);
				},
				error => vscode.window.showErrorMessage(error));
	}
}

export function validateMongoCollectionName(collectionName: string): string | undefined | null {
	// https://docs.mongodb.com/manual/reference/limits/#Restriction-on-Collection-Names
	if (!collectionName) {
		return "Collection name cannot be empty";
	}
	const systemPrefix = "system.";
	if (collectionName.startsWith(systemPrefix)) {
		return `"${systemPrefix}" prefix is reserved for internal use`;
	}
	if (/[$]/.test(collectionName)) {
		return "Collection name cannot contain $";
	}
	return undefined;
}

function withProgress<T>(promise: Thenable<T>, title: string): Thenable<T> {
	return vscode.window.withProgress<T>(
		{
			location: vscode.ProgressLocation.Window,
			title
		},
		(_progress) => {
			return promise;
		});
}

export function stripQuotes(term: string): string {
	if ((term.startsWith('\'') && term.endsWith('\''))
		|| (term.startsWith('"') && term.endsWith('"'))) {
		return term.substring(1, term.length - 1);
	}
	return term;
}
