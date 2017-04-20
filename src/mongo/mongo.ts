import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as fs from 'fs';
import { MongoClient, Db, ReadPreference, Code } from 'mongodb';
import { Shell } from './shell';

export interface IMongoResource {

	id: string

	hasChildren(): boolean;
	loadChildren(): Promise<IMongoResource[]>;
}

export interface IMongoContext {
	extensionContext: vscode.ExtensionContext;
	outputChannel: vscode.OutputChannel;
}

class ServersJson {

	private _filePath: string;

	constructor(context: vscode.ExtensionContext) {
		this._filePath = context.storagePath + '/servers.json';
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

	async write(servers: string[]) {
		fs.writeFile(this._filePath, JSON.stringify(servers));
	}
}

export class Model implements IMongoResource {

	public readonly id: string = '';
	private _serversJson: ServersJson;
	private _servers: Server[];

	constructor(private context: IMongoContext) {
		this._serversJson = new ServersJson(context.extensionContext);
	}

	hasChildren(): boolean { return true; }

	loadChildren(): Promise<IMongoResource[]> {
		return this._serversJson.load().then(servers => {
			this._servers = servers.map(server => new Server(server, this.context));
			return this._servers;
		});
	}

	get servers(): Server[] {
		return this._servers;
	}

	add(connectionString: string) {
		this._servers.push(new Server(connectionString, this.context));
		this._serversJson.write(this._servers.map(server => server.id));
	}
}

export class Server implements IMongoResource {

	private _databases: Database[] = [];

	constructor(public readonly id: string, private context: IMongoContext) {
	}

	hasChildren(): boolean { return true; }

	loadChildren(): Promise<IMongoResource[]> {
		return <Promise<IMongoResource[]>>MongoClient.connect(this.id)
			.then(db => db.admin().listDatabases()
				.then((value: { databases: { name }[] }) => {
					this._databases = value.databases.map(database => new Database(database.name, this, this.context));
					db.close();
					return this._databases;
				}), error => {
				});
	}

	get databases(): Database[] {
		return this._databases;
	}
}

export class Database implements IMongoResource {

	private shell: Shell;
	private shellUri: vscode.Uri;

	constructor(readonly id: string, readonly server: Server, private context: IMongoContext) {
		this.shellUri = vscode.Uri.file(this.context.extensionContext.storagePath + '/' + this.server.id + '_' + this.id + '.mongo')
		if (!fs.existsSync(this.shellUri.fsPath)) {
			this.shellUri = this.shellUri.with({ scheme: 'untitled' });
		}
		this.context.extensionContext.subscriptions.push(vscode.window.onDidChangeActiveTextEditor((editor => {
			if (editor.document.uri.toString() === this.shellUri.toString()) {
				vscode.window.setStatusBarMessage('Connected to ' + id);
			}
		})));
	}

	hasChildren(): boolean { return false; }

	loadChildren(): Promise<IMongoResource[]> {
		return Promise.resolve([]);
	}

	getDb(): Promise<Db> {
		const uri = vscode.Uri.parse(this.server.id);
		const connectionString = `${uri.scheme}://${uri.authority}/${this.id}?${uri.query}`
		return <Promise<Db>>MongoClient.connect(connectionString)
			.then(db => {
				return db.db(this.id)
			});
	}

	getMongoShellUri(): vscode.Uri {
		return this.shellUri;
	}

	executeScript(script: string): Promise<string> {
		return this.getShell()
			.then(() => this.shell.exec(script));
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