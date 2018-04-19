/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import * as mongoParser from './grammar/mongoParser';
import { MongoVisitor } from './grammar/visitors';
import { mongoLexer } from './grammar/mongoLexer';
import * as vscodeUtil from './../utils/vscodeUtils';
import { CosmosEditorManager } from '../CosmosEditorManager';
import { IAzureParentNode, AzureTreeDataProvider, IActionContext } from 'vscode-azureextensionui';
import { MongoFindResultEditor } from './editors/MongoFindResultEditor';
import { MongoFindOneResultEditor } from './editors/MongoFindOneResultEditor';
import { MongoCommand } from './MongoCommand';
import { MongoDatabaseTreeItem } from './tree/MongoDatabaseTreeItem';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';

export class MongoCommands {
	public static async executeCommandFromActiveEditor(database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext): Promise<void> {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor.document.languageId !== 'mongo') {
			vscode.window.showInformationMessage("This command can only be run inside of a MongoDB scrapbook (*.mongo)");
			return;
		}
		const selection = activeEditor.selection;
		const command = MongoCommands.getCommand(activeEditor.document.getText(), selection.start);
		if (command) {
			try {
				context.properties["command"] = command.name;
				context.properties["argsCount"] = String(command.arguments ? command.arguments.length : 0);
			} catch (error) {
				// Ignore
			}

			if (!database) {
				throw new Error('Please select a MongoDB database to run against by selecting it in the explorer and selecting the "Connect" context menu item');
			}
			if (command.errors && command.errors.length > 0) {
				const err = command.errors.reduce((error1, error2) => error1.position.line - error2.position.line || error1.position.character - error2.position.character <= 0 ? error1 : error2);
				throw new Error(`Error near line ${err.position.line}, column ${err.position.character}, text '${err.text}'. Please check syntax.`);
			}
			if (command.name === 'find') {
				await editorManager.showDocument(new MongoFindResultEditor(database, command, tree), 'cosmos-result.json');
			} else {
				const result = await database.treeItem.executeCommand(command, context);
				if (command.name === 'findOne') {
					if (result === "null") {
						throw new Error(`Could not find any documents`)
					}
					await editorManager.showDocument(new MongoFindOneResultEditor(database, command.collection, result, tree), 'cosmos-result.json');
				} else {
					await vscodeUtil.showNewFile(result, extensionPath, 'result', '.json', activeEditor.viewColumn + 1);
				}
			}
		} else {
			throw new Error('No MongoDB command found at the current cursor location.');
		}
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
				const lastCommand = this.commands[this.commands.length - 1];
				if (!lastCommand.arguments) {
					lastCommand.arguments = [];
				}
				lastCommand.arguments.push(ctx.text);
			}
		}
		return super.visitArgumentList(ctx);
	}

	visitErrorNode(node: ErrorNode): MongoCommand[] {
		const position = new vscode.Position(node._symbol.line - 1, node._symbol.charPositionInLine); // Symbol lines are 1 indexed. Position lines are 0 indexed
		const text = node.text;
		const badCommand = this.commands.find((command) => command.range && command.range.contains(position));
		badCommand.errors = badCommand.errors || [];
		badCommand.errors.push({ position: position, text: text });
		return this.defaultResult(node);
	}

	protected defaultResult(_node: ParseTree): MongoCommand[] {
		return this.commands;
	}
}

