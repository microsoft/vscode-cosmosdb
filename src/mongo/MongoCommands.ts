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

const output = vscodeUtil.getOutputChannel();
const notInScrapbookMessage = "This command can only be run inside of a MongoDB scrapbook (*.mongo)";

export class MongoCommands {

	public static async executeAllCommandsFromActiveEditor(database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext): Promise<void> {
		output.show();
		output.appendLine("Running all commands in scrapbook...")
		let commands = MongoCommands.getAllCommandsFromActiveEditor();
		await MongoCommands.executeCommands(commands, vscode.window.activeTextEditor, database, extensionPath, editorManager, tree, context);
	}

	public static async executeCommandFromActiveEditor(database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext): Promise<void> {
		const commands = MongoCommands.getAllCommandsFromActiveEditor();
		const activeEditor = vscode.window.activeTextEditor;
		const selection = activeEditor.selection;
		const command = MongoCommands.findCommandAtPosition(commands, selection.start);
		return this.executeCommand(activeEditor, database, extensionPath, editorManager, tree, context, command);
	}

	public static async executeCommandFromText(database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext, commandText: string): Promise<void> {
		const activeEditor = vscode.window.activeTextEditor;
		const command = MongoCommands.getCommandFromText(commandText, new vscode.Position(0, 0));
		return this.executeCommand(activeEditor, database, extensionPath, editorManager, tree, context, command);
	}

	public static getAllCommandsFromActiveEditor(): MongoCommand[] {
		const activeEditor = vscode.window.activeTextEditor;
		if (activeEditor) {
			const commands = MongoCommands.getAllCommandsFromTextDocument(activeEditor.document);
			return commands;
		} else {
			throw new Error(notInScrapbookMessage);
		}
	}

	public static getAllCommandsFromTextDocument(document: vscode.TextDocument): MongoCommand[] {
		if (document.languageId !== 'mongo') {
			throw new Error(notInScrapbookMessage);
		}

		return MongoCommands.getAllCommands(document.getText());
	}

	public static async executeCommands(commands: MongoCommand[], activeEditor: vscode.TextEditor, database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext): Promise<void> {
		for (let command of commands) {
			await this.executeCommand(activeEditor, database, extensionPath, editorManager, tree, context, command);
		}
	}

	public static async executeCommand(activeEditor: vscode.TextEditor, database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext, command: MongoCommand): Promise<void> {
		if (command) {
			output.show();
			output.appendLine(command.text);

			try {
				context.properties["command"] = command.name;
				context.properties["argsCount"] = String(command.arguments ? command.arguments.length : 0);
			} catch (error) {
				// Ignore
			}

			if (!database) {
				throw new Error('Please select a MongoDB database to run against by selecting it in the explorer and selecting the "Connect" context menu item');
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

	public static getCommandFromText(content: string, position?: vscode.Position): MongoCommand {
		let commands = MongoCommands.getAllCommands(content);
		return this.findCommandAtPosition(commands, position);
	}

	private static getAllCommands(content: string): MongoCommand[] {
		const lexer = new mongoLexer(new InputStream(content));
		lexer.removeErrorListeners();
		const parser = new mongoParser.mongoParser(new CommonTokenStream(lexer));
		parser.removeErrorListeners();

		const commands = new MongoScriptDocumentVisitor().visit(parser.commands());
		return commands;
	}

	private static findCommandAtPosition(commands: MongoCommand[], position?: vscode.Position): MongoCommand {
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

class MongoScriptDocumentVisitor extends MongoVisitor<MongoCommand[]> {

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

	protected defaultResult(node: ParseTree): MongoCommand[] {
		return this.commands;
	}
}
