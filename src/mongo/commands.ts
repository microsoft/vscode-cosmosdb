/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import { MongoDatabaseNode, MongoCommand, MongoDocumentNode } from './nodes';
import * as fs from 'fs';
import * as mongoParser from './grammar/mongoParser';
import { MongoVisitor } from './grammar/visitors';
import { mongoLexer } from './grammar/mongoLexer';
import * as util from './../util'

export class MongoCommands {

	public static async executeCommandFromActiveEditor(database: MongoDatabaseNode): Promise<MongoCommand> {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor.document.languageId !== 'mongo') {
			return;
		}
		const selection = activeEditor.selection;
		const command = MongoCommands.getCommand(activeEditor.document.getText(), selection.start);
		if (command) {
			const result = await MongoCommands.executeCommand(command, database);
			await util.showResult(result, 'result.json', activeEditor.viewColumn + 1);
		} else {
			vscode.window.showErrorMessage('No executable command found.');
		}

		return command;
	}

	public static executeCommand(command: MongoCommand, database: MongoDatabaseNode): Thenable<string> {
		if (!database) {
			vscode.window.showErrorMessage('Please connect to the database first');
			return;
		}
		return database.executeCommand(command)
			.then(result => result, error => vscode.window.showErrorMessage(error));
	}

	public static updateDocuments(database: MongoDatabaseNode, command: MongoCommand, currentDocumentNode: MongoDocumentNode): void {
		if (!database) {
			vscode.window.showErrorMessage('Please connect to the database first');
			return;
		}

		const editor = vscode.window.activeTextEditor;
		const documents = JSON.parse(editor.document.getText());
		currentDocumentNode.data = documents;
		database.updateDocuments(documents, command.collection);
	}

	public static getCommand(content: string, position?: vscode.Position): MongoCommand {
		const lexer = new mongoLexer(new InputStream(content));
		lexer.removeErrorListeners();
		const parser = new mongoParser.mongoParser(new CommonTokenStream(lexer));
		parser.removeErrorListeners();

		const commands = new MongoScriptDocumentVisitor().visit(parser.commands());
		let lastCommandOnSameLine = null;
		let lastCommandBeforePosition = null;
		if (position) {
			for (const command of commands) {
				if (command.range.contains(position)) {
					return command;
				}
				if (command.range.end.line === position.line) {
					lastCommandOnSameLine = command;
				}
				if (command.range.end.isBefore(position)) {
					lastCommandBeforePosition = command;
				}
			}
		}
		return lastCommandOnSameLine || lastCommandBeforePosition || commands[commands.length - 1];
	}
}

export class MongoScriptDocumentVisitor extends MongoVisitor<MongoCommand[]> {

	private commands: MongoCommand[] = [];

	visitCommand(ctx: mongoParser.CommandContext): MongoCommand[] {
		this.commands.push({
			range: new vscode.Range(ctx.start.line - 1, ctx.start.charPositionInLine, ctx.stop.line - 1, ctx.stop.charPositionInLine),
			text: ctx.text,
			name: ''
		});
		return super.visitCommand(ctx);
	}

	visitCollection(ctx: mongoParser.CollectionContext): MongoCommand[] {
		this.commands[this.commands.length - 1].collection = ctx.text;
		return super.visitCollection(ctx);
	}

	visitFunctionCall(ctx: mongoParser.FunctionCallContext): MongoCommand[] {
		if (ctx.parent instanceof mongoParser.CommandContext) {
			this.commands[this.commands.length - 1].name = ctx._FUNCTION_NAME.text;
		}
		return super.visitFunctionCall(ctx);
	}

	visitArgumentList(ctx: mongoParser.ArgumentListContext): MongoCommand[] {
		let argumentsContext = ctx.parent;
		if (argumentsContext) {
			let functionCallContext = argumentsContext.parent;
			if (functionCallContext && functionCallContext.parent instanceof mongoParser.CommandContext) {
				this.commands[this.commands.length - 1].arguments = ctx.text;
			}
		}
		return super.visitArgumentList(ctx);
	}

	protected defaultResult(node: ParseTree): MongoCommand[] {
		return this.commands;
	}
}

