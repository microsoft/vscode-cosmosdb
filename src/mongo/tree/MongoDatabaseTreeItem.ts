/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from 'path';
import { MongoClient, Db, Collection } from 'mongodb';
import { Shell } from '../shell';
import { IAzureParentTreeItem, IAzureTreeItem, IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { DialogBoxResponses } from '../../constants';
import { MongoCollectionTreeItem } from './MongoCollectionTreeItem';
import { MongoCommand } from '../MongoCommand';

export class MongoDatabaseTreeItem implements IAzureParentTreeItem {
	public static contextValue: string = "mongoDb";
	public readonly contextValue: string = MongoDatabaseTreeItem.contextValue;
	public readonly childTypeLabel: string = "Collection";
	public readonly connectionString: string;
	public readonly databaseName: string;

	public isConnected: boolean = false;

	constructor(databaseName: string, connectionString: string) {
		this.databaseName = databaseName;
		this.connectionString = connectionString;
	}

	public get label(): string {
		if (this.isConnected) {
			return this.databaseName + " (Connected)";
		}
		return this.databaseName;
	}

	public get id(): string {
		return this.databaseName;
	}

	get iconPath(): any {
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
		const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
		if (result === DialogBoxResponses.Yes) {
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

	executeCommand(command: MongoCommand): Thenable<string> {
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
					return reportProgress(this.executeCommandInShell(command), 'Executing command');
				});
		}

		if (command.name === 'createCollection') {
			return reportProgress(this.createCollection(stripQuotes(command.arguments)).then(() => JSON.stringify({ 'Created': 'Ok' })), 'Creating collection');
		} else {
			return reportProgress(this.executeCommandInShell(command), 'Executing command');
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

	executeCommandInShell(command: MongoCommand): Thenable<string> {
		return this.getShell().then(shell => shell.exec(command.text));
	}

	private getShell(): Promise<Shell> {
		const shellPath = <string>vscode.workspace.getConfiguration().get('mongo.shell.path')
		if (!shellPath) {
			return <Promise<null>>vscode.window.showInputBox({
				placeHolder: "Configure the path to mongo shell executable",
				ignoreFocusOut: true
			}).then(value => vscode.workspace.getConfiguration().update('mongo.shell.path', value, true)
				.then(() => this.createShell(value)));
		} else {
			return this.createShell(shellPath);
		}
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
	const systemPrefix = "system."
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
		(progress) => {
			return promise;
		})
}

function stripQuotes(term: string): string {
	if ((term.startsWith('\'') && term.endsWith('\''))
		|| (term.startsWith('"') && term.endsWith('"'))) {
		return term.substring(1, term.length - 1);
	}
	return term;
}
