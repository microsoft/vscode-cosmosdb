/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as vm from 'vm';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { MongoClient, Db, ReadPreference, Code, Server as MongoServer, Collection as MongoCollection, Cursor, ObjectID, MongoError, ReplSet } from 'mongodb';
import { Shell } from './shell';
import { EventEmitter, Event, Command } from 'vscode';

export interface MongoCommand {
	range: vscode.Range;
	text: string;
	collection?: string;
	name: string;
	arguments?: string;
}

export interface IMongoResource extends vscode.TreeItem {
	id: string
	label: string;
	getChildren?(): Thenable<IMongoResource[]>;
	onChange?: Event<void>
	contextValue?: string;
	command?: Command;
	iconPath?: { light: string, dark: string };
}

class ServersJson {

	private _filePath: string;

	constructor(storagePath: string) {
		this._filePath = storagePath + '/servers.json';
	}

	async load(): Promise<string[]> {
		return new Promise<string[]>((c, e) => {
			fs.exists(this._filePath, exists => {
				if (exists) {
					fs.readFile(this._filePath, (error, data) => {
						c(<string[]>JSON.parse(data.toString()));
					});
				} else {
					fs.writeFile(this._filePath, JSON.stringify([]), () => c([]));
				}
			})
		});
	}

	async write(servers: string[]): Promise<void> {
		return new Promise<void>((c, e) => {
			fs.writeFile(this._filePath, JSON.stringify(servers), (err) => {
				if (err) {
					e(err);
				} else {
					c(null);
				}
			});
		});
	}
}

export class Model implements IMongoResource {

	readonly id: string = 'mongoExplorer';
	readonly label: string = 'Mongo';
	readonly type: string = 'mongoRoot';
	readonly canHaveChildren: boolean = true;

	private _serversJson: ServersJson;
	private _servers: IMongoResource[] = [];
	private _serverConnections: string[] = [];

	private _onChange: EventEmitter<void> = new EventEmitter<void>();
	readonly onChange: Event<void> = this._onChange.event;

	constructor(storagePath: string) {
		this._serversJson = new ServersJson(storagePath);
	}

	getChildren(): Promise<IMongoResource[]> {
		return this._serversJson.load().then(serverConnections => {
			this._serverConnections = serverConnections;
			return Promise.all(this._serverConnections.map(server => this.resolveServer(server, false)))
				.then(servers => {
					this._servers = servers.filter(server => !!server);
					return this._servers;
				});
		});
	}

	add(connectionString: string) {
		this.resolveServer(connectionString, true)
			.then(server => {
				this._serverConnections.push(connectionString);
				this._serversJson.write(this._serverConnections)
					.then(() => {
						this._onChange.fire();
					});
			});
	}

	remove(server: IMongoResource) {
		const id = server instanceof Server ? server.id : server instanceof NoConnectionServer ? server.id : null;
		const index = this._servers.findIndex((value) => value.id === id);
		if (index !== -1) {
			this._servers.splice(index, 1);
			this._serversJson.write(this._servers.map(server => server.id));
			this._onChange.fire();
		}
	}

	private resolveServer(connectionString: string, throwError: boolean): Promise<IMongoResource> {
		return new Promise((c, e) => {
			MongoClient.connect(connectionString, (error: MongoError, db: Db) => {
				if (error) {
					vscode.window.showErrorMessage(error.message);
					if (throwError) {
						e(error.message);
					} else {
						c(new NoConnectionServer(connectionString, error.message));
					}
				} else {
					c(new Server(connectionString, db.serverConfig));
				}
			});
		})
	}
}

export class NoConnectionServer implements IMongoResource {

	readonly contextValue: string = 'mongoServer';
	readonly label: string;

	constructor(readonly id: string, private readonly error: string) {
		this.label = id;
	}
}

export class Server implements IMongoResource {

	readonly contextValue: string = 'mongoServer';

	private _databases: Database[] = [];
	private _onChange: EventEmitter<void> = new EventEmitter<void>();
	readonly onChange: Event<void> = this._onChange.event;

	constructor(public readonly id: string, private readonly mongoServer: MongoServer) {
		//console.log(mongoServer);
	}

	get host(): string {

		// Azure CosmosDB comes back as a ReplSet
		if (this.mongoServer instanceof ReplSet) {
			// get the first connection string from the seedlist for the ReplSet
			// this may not be best solution, but the connection (below) gives
			// the replicaset host name, which is different than what is in the connection string
			let rs: any = this.mongoServer;
			return rs.s.replset.s.seedlist[0].host;
			
			// returns the replication set host name (different from connction string)
			// let rs: ReplSet = this.mongoServer;
			// let conn: any[] = rs2.connections();
			// return conn[0].host;
			
		} else {
			return this.mongoServer['host'];
		}
	}
	
	get port(): string {

		// Azure CosmosDB comes back as a ReplSet
		if (this.mongoServer instanceof ReplSet) {
			let rs: any = this.mongoServer;
			return rs.s.replset.s.seedlist[0].port;
			
			// returns the replication set port (different from connction string)
			// let rs: ReplSet = this.mongoServer;
			// let conn: any[] = rs2.connections();
			// return conn[0].port;
			
		} else {
			return this.mongoServer['port'];
		}
	}

	get label(): string {
		return `${this.host}:${this.port}`;
	}

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	getChildren(): Promise<IMongoResource[]> {
		return <Promise<IMongoResource[]>>MongoClient.connect(this.id)
			.then(db => db.admin().listDatabases()
				.then((value: { databases: { name }[] }) => {
					this._databases = value.databases.map(database => new Database(database.name, this));
					db.close();
					return <IMongoResource[]>this._databases;
				}));
	}

	get databases(): Database[] {
		return this._databases;
	}

	createDatabase(name: string, collection: string): Thenable<Database> {
		const database = new Database(name, this);
		return database.createCollection(collection)
			.then(() => {
				this._onChange.fire();
				return database;
			});
	}

	dropDb(database: Database): void {
		database.drop().then(() => this._onChange.fire());
	}
}

export class Database implements IMongoResource {

	readonly contextValue: string = 'mongoDb';

	private _onChange: EventEmitter<void> = new EventEmitter<void>();
	readonly onChange: Event<void> = this._onChange.event;

	constructor(readonly id: string, readonly server: Server) {
	}

	get label(): string {
		return this.id;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'media', 'dark', 'database-dark.png'),
			dark: path.join(__filename, '..', '..', '..', '..', 'media', 'light', 'database-light.png')
		};
	}

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	getChildren(): Promise<IMongoResource[]> {
		return <Promise<IMongoResource[]>>this.getDb().then(db => {
			return db.collections().then(collections => {
				return collections.map(collection => new Collection(collection, this));
			})
		});
	}

	getDb(): Promise<Db> {
		const uri = vscode.Uri.parse(this.server.id);
		const connectionString = `${uri.scheme}://${uri.authority}/${this.id}?${uri.query}`
		return <Promise<Db>>MongoClient.connect(connectionString)
			.then(db => {
				return db.db(this.id)
			});
	}

	executeCommand(command: MongoCommand): Thenable<string> {
		if (command.collection) {
			return this.getDb()
				.then(db => {
					const collection = db.collection(command.collection);
					if (collection) {
						const result = new Collection(collection, this).executeCommand(command.name, command.arguments);
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

	updateDocuments(documentOrDocuments: any, collectionName: string): Thenable<string> {
		return this.getDb()
			.then(db => {
				const collection = db.collection(collectionName);
				if (collection) {
					return new Collection(collection, this).update(documentOrDocuments);
				}
			});
	}

	createCollection(collectionName: string): Promise<Collection> {
		return this.getDb()
			.then(db => db.createCollection(collectionName))
			.then(collection => {
				this._onChange.fire();
				return new Collection(collection, this);
			});
	}

	drop(): Thenable<any> {
		return this.getDb().then(db => db.dropDatabase());
	}

	dropCollection(collectionName: string): Thenable<string> {
		return this.getDb().then(db => {
			return db.dropCollection(collectionName)
				.then(result => {
					if (result) {
						this._onChange.fire();
					}
					return JSON.stringify({ 'dropped': result });
				});
		});
	}

	private getCollection(collection: string): Promise<Collection> {
		return this.getDb().then(db => new Collection(db.collection(collection), this));
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

	private createShell(shellPath: string): Promise<Shell> {
		return <Promise<null>>Shell.create(shellPath, this.server.id)
			.then(shell => {
				return shell.useDatabase(this.id).then(() => shell);
			}, error => vscode.window.showErrorMessage(error));
	}
}

export class Collection implements IMongoResource {

	constructor(private collection: MongoCollection, readonly db: Database) {
	}

	get id(): string {
		return this.collection.collectionName;
	}

	get label(): string {
		return this.collection.collectionName;
	}

	get iconPath(): any {
		return {
			light: path.join(__filename, '..', '..', '..', '..', 'media', 'dark', 'collection-dark.png'),
			dark: path.join(__filename, '..', '..', '..', '..', 'media', 'light', 'collection-light.png')
		};
	}

	readonly command: Command = {
		command: 'mongo.openCollection',
		arguments: [this],
		title: ''
	};

	executeCommand(name: string, args?: string): Thenable<string> {
		try {
			if (name === 'find') {
				return reportProgress(this.find(args ? parseJSContent(args) : undefined), 'Running find query');
			}
			if (name === 'drop') {
				return reportProgress(this.drop(), 'Dropping collection');
			}
			if (name === 'findOne') {
				return reportProgress(this.findOne(args ? parseJSContent(args) : undefined), 'Running find query');
			}
			if (name === 'insertMany') {
				return reportProgress(this.insertMany(args ? parseJSContent(args) : undefined), 'Inserting documents');
			}
			if (name === 'insert') {
				return reportProgress(this.insert(args ? parseJSContent(args) : undefined), 'Inserting document');
			}
			if (name === 'insertOne') {
				return reportProgress(this.insertOne(args ? parseJSContent(args) : undefined), 'Inserting document');
			}
			if (name === 'deleteOne') {
				return reportProgress(this.deleteOne(args ? parseJSContent(args) : undefined), 'Deleting document');
			}
			if (name === 'deleteMany') {
				return reportProgress(this.deleteMany(args ? parseJSContent(args) : undefined), 'Deleting documents');
			}
			if (name === 'remove') {
				return reportProgress(this.remove(args ? parseJSContent(args) : undefined), 'Removing');
			}
			return null;
		} catch (error) {
			return Promise.resolve(error);
		}
	}

	update(documentOrDocuments: any): Thenable<string> {
		let operations = this.toOperations(documentOrDocuments);
		return reportProgress(this.collection.bulkWrite(operations, { w: 1 })
			.then(result => {
				return this.stringify(result);
			}, (error) => {
				console.log(error);
				return Promise.resolve(null);
			}), 'Updating');
	}

	private drop(): Thenable<string> {
		return this.db.dropCollection(this.collection.collectionName);
	}

	private find(args?: any): Thenable<string> {
		const maxDocs = 20;
		return this.collection.find(args).limit(maxDocs)
			.toArray().then(docs => this.stringify(docs));
	}

	private findOne(args?: any): Thenable<string> {
		return this.collection.findOne(args)
			.then(result => this.stringify(result));
	}

	private insert(document: any): Thenable<string> {
		return this.collection.insert(document)
			.then(({ insertedCount, insertedId, result }) => {
				return this.stringify({ insertedCount, insertedId, result })
			});
	}

	private insertOne(document: any): Thenable<string> {
		return this.collection.insertOne(document)
			.then(({ insertedCount, insertedId, result }) => {
				return this.stringify({ insertedCount, insertedId, result })
			});
	}

	private insertMany(documents: any[]): Thenable<string> {
		return this.collection.insertMany(documents)
			.then(({ insertedCount, insertedIds, result }) => {
				return this.stringify({ insertedCount, insertedIds, result })
			});
	}

	private remove(args?: any): Thenable<string> {
		return this.collection.remove(args)
			.then(({ ops, result }) => {
				return this.stringify({ ops, result })
			});
	}

	private deleteOne(args?: any): Thenable<string> {
		return this.collection.deleteOne(args)
			.then(({ deletedCount, result }) => {
				return this.stringify({ deletedCount, result })
			});
	}

	private deleteMany(args?: any): Thenable<string> {
		return this.collection.deleteMany(args)
			.then(({ deletedCount, result }) => {
				return this.stringify({ deletedCount, result })
			});
	}

	private stringify(result: any): string {
		return JSON.stringify(result, null, '\t')
	}

	private toOperations(documentOrDocuments: any[]): any[] {
		const documents = Array.isArray(documentOrDocuments) ? documentOrDocuments : [documentOrDocuments];
		return documents.reduce((result, doc) => {
			const id = doc._id;
			delete doc._id;
			result.push({
				updateOne: {
					filter: {
						_id: new ObjectID(id)
					},
					update: doc
				}
			});
			return result;
		}, []);
	}
}

function reportProgress<T>(promise: Thenable<T>, title: string): Thenable<T> {
	return vscode.window.withProgress<T>({
		location: vscode.ProgressLocation.Window,
		title
	}, (progress) => {
		return promise;
	})
}

function parseJSContent(content: string): any {
	try {
		const sandbox = {};
		const key = 'parse' + Math.floor(Math.random() * 1000000);
		sandbox[key] = {};
		vm.runInNewContext(key + '=' + content, sandbox);
		return sandbox[key];
	} catch (error) {
		throw error.message;
	}
}

function stripQuotes(term: string): string {
	if ((term.startsWith('\'') && term.endsWith('\''))
		|| (term.startsWith('"') && term.endsWith('"'))) {
		return term.substring(1, term.length - 1);
	}
	return term;
}