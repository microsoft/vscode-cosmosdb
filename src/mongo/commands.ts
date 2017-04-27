import * as path from 'path';
import * as vscode from 'vscode';
import { Model, Server, Database } from './mongo';
import * as fs from 'fs';

export class ResultDocument implements vscode.TextDocumentContentProvider {

	private _result: Map<string, string> = new Map<string, any>();

	private _onDidChange: vscode.EventEmitter<vscode.Uri> = new vscode.EventEmitter<vscode.Uri>();
	public readonly onDidChange: vscode.Event<vscode.Uri> = this._onDidChange.event;

	constructor(context: vscode.ExtensionContext) {
		context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('mongo', this));
	}

	provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
		const result = this._result.get(uri.toString())
		return result ? result : '';
	}

	setResult(uri: vscode.Uri, result: string) {
		this._result.set(uri.toString(), result);
		this._onDidChange.fire(uri);
	}
}

export class MongoCommands {

	public static addServer(model: Model): void {
		vscode.window.showInputBox({
			placeHolder: 'mongodb://host:port'
		}).then(value => {
			if (value) {
				model.add(value);
			}
		});
	}

	public static openShell(database: Database): void {
		let uri = vscode.Uri.file(path.join(vscode.workspace.rootPath, database.server.host + '_' + database.server.port + '_' + database.label + '.mongo'));
		const exists = fs.existsSync(uri.fsPath);
		if (!exists) {
			uri = uri.with({ scheme: 'untitled' });
		}
		vscode.workspace.openTextDocument(uri)
			.then(textDocument => {
				return vscode.window.showTextDocument(textDocument)
					.then(editor => {
						if (!exists && !MongoCommands.isShellDocument(textDocument, database)) {
							editor.edit(builder => {
								builder.insert(new vscode.Position(0, 0), database.connectionString + '\n');
							});
						}
					});
			});
	}

	public static executeScript(model: Model, resultDocument: ResultDocument, outputChannel: vscode.OutputChannel, selection: boolean): void {
		const editor = vscode.window.activeTextEditor;
		if (editor.document.languageId === 'mongo' || editor.document.uri.fsPath.endsWith('.mongo')) {
			const text = selection ? MongoCommands.getSelectedText(editor) : editor.document.lineAt(editor.selection.start.line).text;
			const database = MongoCommands.getDatabaseForDocument(editor.document, model);
			if (database) {
				database.executeScript(text)
					.then(result => {
						const uri = vscode.Uri.parse('mongo://test/result.json');
						resultDocument.setResult(uri, result);
						vscode.workspace.openTextDocument(uri)
							.then(textDocument => {
								vscode.window.showTextDocument(textDocument, vscode.ViewColumn.Two, true);
							});
						outputChannel.append(result);
					});
			} else {
				vscode.window.showErrorMessage('Please connect to the database first');
			}
		}
	}

	private static getSelectedText(editor: vscode.TextEditor): string {
		const selection = editor.selection;
		if (selection.start.isEqual(selection.end)) {
			editor.document.getText();
		}
		return editor.document.getText(selection);
	}

	public static getDatabaseForDocument(document: vscode.TextDocument, model: Model) {
		if (document.languageId === 'mongo' || document.uri.fsPath.endsWith('.mongo')) {
			for (const server of model.servers) {
				for (const database of server.databases) {
					if (MongoCommands.isShellDocument(document, database)) {
						return database;
					}
				}
			}
		}
		return null;
	}

	public static isShellDocument(document: vscode.TextDocument, database: Database): boolean {
		return database.connectionString === document.lineAt(0).text;
	}
}