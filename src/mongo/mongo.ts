import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { MongoClient, Db, ReadPreference, Code, Server as MongoServer, Collection as MongoCollection, Cursor, ObjectID } from 'mongodb';
import { Shell } from './shell';
import { EventEmitter, Event, Command } from 'vscode';

export interface MongoScript {
	range: vscode.Range;
	script: string;
	collection?: string;
	command: string;
	arguments?: string;
}

export interface IMongoResource {
	label: string;
	getChildren?(): Thenable<IMongoResource[]>;
	onChange?: Event<void>
	contextKey?: string;
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
	private _servers: Server[] = [];
	private _serverConnections: string[] = [];

	private _onChange: EventEmitter<void> = new EventEmitter<void>();
	readonly onChange: Event<void> = this._onChange.event;

	constructor(storagePath: string) {
		this._serversJson = new ServersJson(storagePath);
	}

	getChildren(): Promise<IMongoResource[]> {
		return this._serversJson.load().then(serverConnections => {
			this._serverConnections = serverConnections;
			return Promise.all(this._serverConnections.map(server => this.resolveServer(server)))
				.then(servers => {
					this._servers = servers;
					return this._servers;
				});
		});
	}

	get servers(): Server[] {
		return this._servers;
	}

	add(connectionString: string) {
		this._serverConnections.push(connectionString);
		this._serversJson.write(this._serverConnections)
			.then(() => {
				this._onChange.fire();
			});
	}

	remove(id: string) {
		const index = this._servers.findIndex((value) => value.id === id);
		if (index !== -1) {
			this._servers.splice(index, 1);
			this._serversJson.write(this._servers.map(server => server.id));
			this._onChange.fire();
		}
	}

	private resolveServer(connectionString: string): Promise<Server> {
		return <Promise<Server>>MongoClient.connect(connectionString)
			.then(db => {
				return new Server(connectionString, db.serverConfig);
			});
	}
}

export class Server implements IMongoResource {

	readonly contextKey: string = 'mongoServer';

	private _databases: Database[] = [];

	constructor(public readonly id: string, private readonly mongoServer: MongoServer) {
	}

	get host(): string {
		return this.mongoServer['host'];
	}

	get port(): string {
		return this.mongoServer['port'];
	}

	get label(): string {
		return `${this.host}:${this.port}`;
	}

	readonly canHaveChildren: boolean = true;

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
}

export class Database implements IMongoResource {

	readonly contextKey: string = 'mongoDb';
	private shell: Shell;

	constructor(readonly id: string, readonly server: Server) {
	}

	get label(): string {
		return this.id;
	}

	readonly canHaveChildren: boolean = true;

	getChildren(): Promise<IMongoResource[]> {
		return <Promise<IMongoResource[]>>this.getDb().then(db => {
			return db.collections().then(collections => {
				return collections.map(collection => new Collection(collection));
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

	executeScript(script: MongoScript): Thenable<string> {
		if (script.collection) {
			return this.getDb()
				.then(db => {
					const collection = db.collection(script.collection);
					if (collection) {
						const result = new Collection(collection).executeCommand(script.command, script.arguments);
						if (result) {
							return result;
						}
					}
					return reportProgress(this.getShell().then(() => this.shell.exec(script.script)), 'Executing script');
				});
		}
		return reportProgress(this.getShell().then(() => this.shell.exec(script.script)), 'Executing script');
	}

	updateDocuments(documents: any[], collectionName: string): Thenable<string> {
		return this.getDb()
			.then(db => {
				const collection = db.collection(collectionName);
				if (collection) {
					return new Collection(collection).update(documents);
				}
			});
	}

	private getCollection(collection: string): Promise<Collection> {
		return this.getDb().then(db => new Collection(db.collection(collection)));
	}

	private getShell(): Promise<void> {
		if (this.shell) {
			return Promise.resolve();
		}
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

	private createShell(shellPath: string): Promise<void> {
		return <Promise<null>>Shell.create(shellPath, this.server.id)
			.then(shell => {
				this.shell = shell;
				return this.shell.useDatabase(this.id).then(() => null);
			}, error => vscode.window.showErrorMessage(error));
	}

	_executeScript(script: string): Promise<string> {
		return this.getDb().then(db => {
			return db.eval(new Code(`function() {
				var result = ${script};
				if (result.hasNext) {
					let results = [];
					for (let counter = 0; counter < 20 && result.hasNext(); counter++) {
						results.push(result.next());
					}
					return results;
				} else {
					return result;
				}
			}`), [], { readPreference: ReadPreference.PRIMARY }).then(result => {
					db.close();
					return JSON.stringify(result, null, '\t')
				}, error => {
					console.log(error);
				});
		});
	}
}

export class Collection implements IMongoResource {

	constructor(private collection: MongoCollection) {
	}

	get label(): string {
		return this.collection.collectionName;
	}

	readonly canHaveChildren: boolean = false;

	executeCommand(command: string, args?: string): Thenable<string> {
		if (command === 'find') {
			return reportProgress(this.find(args ? JSON.parse(args) : undefined), 'Running find query');
		}
		if (command === 'findOne') {
			return reportProgress(this.findOne(args ? JSON.parse(args) : undefined), 'Running find query');
		}
		return null;
	}

	update(documents: any[]): Thenable<string> {
		let operations = this.toOperations(documents);
		return reportProgress(this.collection.bulkWrite(operations, { w: 1 })
			.then(result => {
				return this.stringify(result);
			}, (error) => {
				console.log(error);
			}), 'Updating');
	}

	private find(args?: any): Promise<string> {
		const promise = new Promise((c, e) => {
			let cursor = this.collection.find(args);
			this.readNext([], cursor, 20, c);
		});
		return promise;
	}

	private findOne(args?: any): Promise<string> {
		return new Promise((c, e) => {
			this.collection.findOne(args)
				.then(result => c(this.stringify(result)));
		});
	}

	private readNext(result: any[], cursor: Cursor<any>, batchSize: number, callback: (result: string) => void): void {
		if (result.length === batchSize) {
			callback(this.stringify(result));
			return;
		}

		cursor.hasNext().then(hasNext => {
			if (!hasNext) {
				callback(this.stringify(result));
				return;
			}

			cursor.next().then(doc => {
				result.push(doc);
				this.readNext(result, cursor, batchSize, callback);
			})
		})
	}

	private stringify(result: any): string {
		return JSON.stringify(result, null, '\t')
	}

	private toOperations(documents: any[]): any[] {
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