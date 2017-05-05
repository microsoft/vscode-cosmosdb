import * as path from 'path';
import * as vscode from 'vscode';
import { Model, Server, Database } from './mongo';
import * as fs from 'fs';

export class MongoCommands {

	public static executeScript(database: Database): void {
		if (!database) {
			vscode.window.showErrorMessage('Please connect to the database first');
			return;
		}

		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor.document.languageId !== 'mongo') {
			return;
		}

		const text = activeEditor.document.lineAt(activeEditor.selection.start.line).text;
		let uri = vscode.Uri.file(path.join(vscode.workspace.rootPath, 'result.json'));
		uri = uri.with({ scheme: 'untitled' });
		vscode.workspace.openTextDocument(uri)
			.then(textDocument => vscode.window.showTextDocument(textDocument, vscode.ViewColumn.Two, true))
			.then(editor => {
				database.executeScript(text)
					.then(result => {
						editor.edit(editorBuilder => {
							if (editor.document.lineCount > 0) {
								const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
								editorBuilder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine.range.start.line, lastLine.range.end.character)));
							}
							editorBuilder.insert(new vscode.Position(0, 0), result);
						});
					});
			});
	}
}