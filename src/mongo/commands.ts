/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import { Model, Server, Database, MongoScript } from './mongo';
import * as fs from 'fs';
import * as mongoParser from './../grammar/mongoParser';
import { MongoVisitor } from './../grammar/visitors';
import { mongoLexer } from './../grammar/mongoLexer';

export class MongoCommands {

	public static executeScriptFromActiveEditor(database: Database): MongoScript {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor.document.languageId !== 'mongo') {
			return;
		}
		const selection = activeEditor.selection;
		const script = MongoCommands.getMongoScript(activeEditor.document.getText(), selection.start);
		MongoCommands.executeScript(script, database)
			.then(result => this.showResult(result, activeEditor.viewColumn + 1));
		return script;
	}

	public static executeScript(script: MongoScript, database: Database): Thenable<string> {
		if (!database) {
			vscode.window.showErrorMessage('Please connect to the database first');
			return;
		}
		return database.executeScript(script)
			.then(result => result, error => vscode.window.showErrorMessage(error));
	}

	public static showResult(result: string, column?: vscode.ViewColumn): Thenable<void> {
		let uri = vscode.Uri.file(path.join(vscode.workspace.rootPath, 'result.json'));
		if (!fs.existsSync(uri.fsPath)) {
			uri = uri.with({ scheme: 'untitled' });
		}
		return vscode.workspace.openTextDocument(uri)
			.then(textDocument => vscode.window.showTextDocument(textDocument, column ? column > vscode.ViewColumn.Three ? vscode.ViewColumn.One : column : undefined, true))
			.then(editor => {
				editor.edit(editorBuilder => {
					if (editor.document.lineCount > 0) {
						const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
						editorBuilder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine.range.start.line, lastLine.range.end.character)));
					}
					editorBuilder.insert(new vscode.Position(0, 0), result);
				});
			});
	}

	public static updateDocuments(database: Database, script: MongoScript): void {
		if (!database) {
			vscode.window.showErrorMessage('Please connect to the database first');
			return;
		}

		const editor = vscode.window.activeTextEditor;
		const documents = JSON.parse(editor.document.getText());
		database.updateDocuments(documents, script.collection)
			.then(result => {
				editor.edit(editorBuilder => {
					if (editor.document.lineCount > 0) {
						const lastLine = editor.document.lineAt(editor.document.lineCount - 1);
						editorBuilder.delete(new vscode.Range(new vscode.Position(0, 0), new vscode.Position(lastLine.range.start.line, lastLine.range.end.character)));
					}
					editorBuilder.insert(new vscode.Position(0, 0), result);
				});
			});
	}

	public static getMongoScript(content: string, position?: vscode.Position): MongoScript {
		const lexer = new mongoLexer(new InputStream(content));
		lexer.removeErrorListeners();
		const parser = new mongoParser.mongoParser(new CommonTokenStream(lexer));
		parser.removeErrorListeners();

		const scripts = new MongoScriptDocumentVisitor().visit(parser.commands());
		let lastScriptOnSameLine = null;
		let lastScriptBeforePosition = null;
		if (position) {
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
		}
		return lastScriptOnSameLine || lastScriptBeforePosition || scripts[scripts.length - 1];
	}
}

export class MongoScriptDocumentVisitor extends MongoVisitor<MongoScript[]> {

	private mongoScripts: MongoScript[] = [];

	visitCommand(ctx: mongoParser.CommandContext): MongoScript[] {
		this.mongoScripts.push({
			range: new vscode.Range(ctx.start.line - 1, ctx.start.charPositionInLine, ctx.stop.line - 1, ctx.stop.charPositionInLine),
			script: ctx.text,
			command: ''
		});
		return super.visitCommand(ctx);
	}

	visitCollection(ctx: mongoParser.CollectionContext): MongoScript[] {
		this.mongoScripts[this.mongoScripts.length - 1].collection = ctx.text;
		return super.visitCollection(ctx);
	}

	visitFunctionCall(ctx: mongoParser.FunctionCallContext): MongoScript[] {
		if (ctx.parent instanceof mongoParser.CommandContext) {
			this.mongoScripts[this.mongoScripts.length - 1].command = ctx._FUNCTION_NAME.text;
		}
		return super.visitFunctionCall(ctx);
	}

	visitArgumentList(ctx: mongoParser.ArgumentListContext): MongoScript[] {
		let argumentsContext = ctx.parent;
		if (argumentsContext) {
			let functionCallContext = argumentsContext.parent;
			if (functionCallContext && functionCallContext.parent instanceof mongoParser.CommandContext) {
				this.mongoScripts[this.mongoScripts.length - 1].arguments = ctx.text;
			}
		}
		return super.visitArgumentList(ctx);
	}

	protected defaultResult(node: ParseTree): MongoScript[] {
		return this.mongoScripts;
	}

}

