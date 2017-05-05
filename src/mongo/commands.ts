import * as path from 'path';
import * as vscode from 'vscode';
import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import { Model, Server, Database } from './mongo';
import * as fs from 'fs';
import * as mongoParser from './../grammar/mongoParser';
import { MongoVisitor } from './../grammar/visitors';
import { mongoLexer } from './../grammar/mongoLexer';

export interface MongoScript {
	range: vscode.Range;
	script: string;
}

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

		const selection = activeEditor.selection;
		let text = activeEditor.document.lineAt(activeEditor.selection.start.line).text;
		if (selection.start.isEqual(selection.end)) {
			const script = MongoCommands.provideScriptAt(activeEditor.document, selection.start);
			if (script) {
				text = script.script;
			}
		} else {
			text = activeEditor.document.getText(selection);
		}
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

	private static provideScriptAt(textDocument: vscode.TextDocument, position: vscode.Position): MongoScript {
		const lexer = new mongoLexer(new InputStream(textDocument.getText()));
		lexer.removeErrorListeners();
		const parser = new mongoParser.mongoParser(new CommonTokenStream(lexer));
		parser.removeErrorListeners();

		const scripts = new MongoScriptDocumentVisitor().visit(parser.commands());
		let lastScriptOnSameLine = null;
		let lastScriptBeforePosition = null;
		for (const script of scripts) {
			if (script.range.contains(position)) {
				return script;
			}
			if (script.range.end.line === position.line) {
				lastScriptOnSameLine = script;
			}
			if (script.range.end.isBefore(position)) {
				lastScriptBeforePosition = script;
			}
		}
		return lastScriptOnSameLine || lastScriptBeforePosition;
	}
}

export class MongoScriptDocumentVisitor extends MongoVisitor<MongoScript[]> {

	private mongoScripts: MongoScript[] = [];

	visitCommand(ctx: mongoParser.CommandContext): MongoScript[] {
		this.mongoScripts.push({
			range: new vscode.Range(ctx.start.line - 1, ctx.start.charPositionInLine, ctx.stop.line - 1, ctx.stop.charPositionInLine),
			script: ctx.text
		});
		return this.mongoScripts;
	}
}

