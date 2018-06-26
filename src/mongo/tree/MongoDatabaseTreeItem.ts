/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as cpUtils from '../../utils/cp';
import * as path from 'path';
import { MongoClient, Db, Collection } from 'mongodb';
import { Shell } from '../shell';
import { IAzureParentTreeItem, IAzureTreeItem, IAzureNode, UserCancelledError, IActionContext, DialogResponses } from 'vscode-azureextensionui';
import { MongoCollectionTreeItem } from './MongoCollectionTreeItem';
import { MongoCommand } from '../MongoCommand';
import { ext } from '../../extensionVariables';

export class MongoDatabaseTreeItem implements IAzureParentTreeItem {
	public static contextValue: string = "mongoDb";
	public readonly contextValue: string = MongoDatabaseTreeItem.contextValue;
	public readonly childTypeLabel: string = "Collection";
	public readonly connectionString: string;
	public readonly databaseName: string;

	private _parentId: string;

	constructor(databaseName: string, connectionString: string, parentId: string) {
		this.databaseName = databaseName;
		this.connectionString = connectionString;
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
		const accountConnection = await MongoClient.connect(this.connectionString);
		return accountConnection.db(this.databaseName);
	}

	executeCommand(command: MongoCommand, context: IActionContext): Thenable<string> {
		if (command.collection) {
			return this.getDb()
				.then(db => {
					const collection = db.collection(command.collection);
					if (collection) {
						const result = new MongoCollectionTreeItem(collection, command.arguments).executeCommand(command.name, command.arguments);
						if (result) {
							return result;
						}
					}
					return reportProgress(this.executeCommandInShell(command, context), 'Executing command');
				});
		}

		if (command.name === 'createCollection') {
			return reportProgress(this.createCollection(stripQuotes(command.arguments.join(','))).then(() => JSON.stringify({ 'Created': 'Ok' })), 'Creating collection');
		} else {
			return reportProgress(this.executeCommandInShell(command, context), 'Executing command');
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
		const settingKey: string = ext.settingsKeys.mongoShellPath;
		let shellPath: string | undefined = vscode.workspace.getConfiguration().get(settingKey);
		if (!shellPath) {
			if (await cpUtils.commandSucceeds('mongo', '--version')) {
				// If the user already has mongo in their system path, just use that
				shellPath = 'mongo';
			} else {
				// If all else fails, prompt the user for the mongo path
				shellPath = await vscode.window.showInputBox({
					placeHolder: "Configure the path to the mongo shell executable",
					ignoreFocusOut: true
				});

				if (shellPath) {
					await vscode.workspace.getConfiguration().update(settingKey, shellPath, vscode.ConfigurationTarget.Global);
				} else {
					throw new UserCancelledError();
				}
			}
		}

		return await this.createShell(shellPath);
	}

	private async createShell(shellPath: string): Promise<Shell> {
		return <Promise<null>>Shell.create(shellPath, this.connectionString)
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

function reportProgress<T>(promise: Thenable<T>, title: string): Thenable<T> {
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
