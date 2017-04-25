import * as vscode from 'vscode';
import { Model, Server, Database } from './mongo';

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

	public static addServer(model: Model, context: vscode.ExtensionContext): void {
		vscode.window.showInputBox({
			placeHolder: 'Server connection string'
		}).then(value => {
			if (value) {
				model.add(value);
			}
		})
	}

	public static openShell(database: Database): void {
		const uri = database.getMongoShellUri();
		vscode.workspace.openTextDocument(uri)
			.then(textDocument => {
				return vscode.window.showTextDocument(textDocument)
					.then(editor => {
						if (uri.scheme === 'untitled' && !textDocument.getText()) {
							editor.edit(builder => {
								builder.insert(new vscode.Position(0, 0), '#!/usr/bin/env mongo\n');
							});
						}
					})
			});
	}

	public static executeScript(model: Model, resultDocument: ResultDocument, outputChannel: vscode.OutputChannel, selection: boolean): void {
		const editor = vscode.window.activeTextEditor;
		if (editor.document.languageId === 'mongo' || editor.document.uri.fsPath.endsWith('.mongo')) {
			const text = selection ? MongoCommands.getSelectedText(editor) : editor.document.lineAt(editor.selection.start.line).text;
			const database = MongoCommands.getDatabaseWithUri(editor.document.uri, model);
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

	private static getDatabaseWithUri(uri: vscode.Uri, model: Model) {
		for (const server of model.servers) {
			for (const database of server.databases) {
				if (database.getMongoShellUri().toString() === uri.toString()) {
					return database;
				}
			}
		}
		return null;
	}
}