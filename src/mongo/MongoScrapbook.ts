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
import { MongoDatabaseTreeItem, stripQuotes } from './tree/MongoDatabaseTreeItem';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';
import { filterType, findType } from '../utils/array';

const output = vscodeUtil.getOutputChannel();
const notInScrapbookMessage = "You must have a MongoDB scrapbook (*.mongo) open to run a MongoDB command.";

export function getAllErrorsFromTextDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
	let commands = getAllCommandsFromTextDocument(document);
	let errors: vscode.Diagnostic[] = [];
	for (let command of commands) {
		for (let error of (command.errors || [])) {
			let diagnostic = new vscode.Diagnostic(error.range, error.message);
			errors.push(diagnostic);
		}
	}

	return errors;
}

export async function executeAllCommandsFromActiveEditor(database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext): Promise<void> {
	output.appendLine("Running all commands in scrapbook...");
	let commands = getAllCommandsFromActiveEditor();
	await executeCommands(vscode.window.activeTextEditor, database, extensionPath, editorManager, tree, context, commands);
}

export async function executeCommandFromActiveEditor(database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext): Promise<void> {
	const commands = getAllCommandsFromActiveEditor();
	const activeEditor = vscode.window.activeTextEditor;
	const selection = activeEditor.selection;
	const command = findCommandAtPosition(commands, selection.start);
	return await executeCommand(activeEditor, database, extensionPath, editorManager, tree, context, command);
}

export async function executeCommandFromText(database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext, commandText: string): Promise<void> {
	const activeEditor = vscode.window.activeTextEditor;
	const command = getCommandFromText(commandText, new vscode.Position(0, 0));
	return await executeCommand(activeEditor, database, extensionPath, editorManager, tree, context, command);
}

function getAllCommandsFromActiveEditor(): MongoCommand[] {
	const activeEditor = vscode.window.activeTextEditor;
	if (activeEditor) {
		const commands = getAllCommandsFromTextDocument(activeEditor.document);
		return commands;
	} else {
		// Shouldn't be able to reach this
		throw new Error(notInScrapbookMessage);
	}
}

export function getAllCommandsFromTextDocument(document: vscode.TextDocument): MongoCommand[] {
	return getAllCommands(document.getText());
}

async function executeCommands(activeEditor: vscode.TextEditor, database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext, commands: MongoCommand[]): Promise<void> {
	for (let command of commands) {
		await executeCommand(activeEditor, database, extensionPath, editorManager, tree, context, command);
	}
}

async function executeCommand(activeEditor: vscode.TextEditor, database: IAzureParentNode<MongoDatabaseTreeItem>, extensionPath, editorManager: CosmosEditorManager, tree: AzureTreeDataProvider, context: IActionContext, command: MongoCommand): Promise<void> {
	if (command) {
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
		if (command.errors && command.errors.length > 0) {
			//Currently, we take the first error pushed. Tests correlate that the parser visits errors in left-to-right, top-to-bottom.
			const err = command.errors[0];
			throw new Error(`Error near line ${err.range.start.line}, column ${err.range.start.character}: '${err.message}'. Please check syntax.`);
		}
		if (command.name === 'find') {
			await editorManager.showDocument(new MongoFindResultEditor(database, command, tree), 'cosmos-result.json', { showInNextColumn: true });
		} else {
			const result = await database.treeItem.executeCommand(command, context);
			if (command.name === 'findOne') {
				if (result === "null") {
					throw new Error(`Could not find any documents`);
				}
				await editorManager.showDocument(new MongoFindOneResultEditor(database, command.collection, result, tree), 'cosmos-result.json', { showInNextColumn: true });
			} else {
				await vscodeUtil.showNewFile(result, extensionPath, 'result', '.json', activeEditor.viewColumn + 1);
			}
		}
	} else {
		throw new Error('No MongoDB command found at the current cursor location.');
	}
}

export function getCommandFromText(content: string, position?: vscode.Position): MongoCommand {
	let commands = getAllCommands(content);
	return findCommandAtPosition(commands, position);
}

function getAllCommands(content: string): MongoCommand[] {
	const lexer = new mongoLexer(new InputStream(content));
	lexer.removeErrorListeners();
	const parser = new mongoParser.mongoParser(new CommonTokenStream(lexer));
	parser.removeErrorListeners();

	const commands = new MongoScriptDocumentVisitor().visit(parser.commands());
	return commands;
}

function findCommandAtPosition(commands: MongoCommand[], position?: vscode.Position): MongoCommand {
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

class MongoScriptDocumentVisitor extends MongoVisitor<MongoCommand[]> {

	private commands: MongoCommand[] = [];

	visitCommand(ctx: mongoParser.CommandContext): MongoCommand[] {
		this.commands.push({
			range: new vscode.Range(ctx.start.line - 1, ctx.start.charPositionInLine, ctx.stop.line - 1, ctx.stop.charPositionInLine),
			text: ctx.text,
			name: '',
			arguments: [],
			argumentObjects: []
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

	visitArgument(ctx: mongoParser.ArgumentContext): MongoCommand[] {
		let argumentsContext = ctx.parent;
		if (argumentsContext) {
			let functionCallContext = argumentsContext.parent;
			if (functionCallContext && functionCallContext.parent instanceof mongoParser.CommandContext) {
				const lastCommand = this.commands[this.commands.length - 1];
				const argAsObject = this.contextToObject(ctx);
				lastCommand.argumentObjects.push(argAsObject);
				lastCommand.arguments.push(JSON.stringify(argAsObject));
			}
		}
		return super.visitArgument(ctx);
	}

	visitErrorNode(node: ErrorNode): MongoCommand[] {
		const position = new vscode.Position(node._symbol.line - 1, node._symbol.charPositionInLine); // Symbol lines are 1 indexed. Position lines are 0 indexed
		const text = node.text;
		const badCommand = this.commands.find((command) => command.range && command.range.contains(position));
		if (badCommand) {
			// Need a place to hang errors that occur when no command is actually recognized
			badCommand.errors = badCommand.errors || [];
			let message: string = text;
			let range = new vscode.Range(position, position);
			badCommand.errors.push({ range, message });
		}
		return this.defaultResult(node);
	}

	protected defaultResult(_node: ParseTree): MongoCommand[] {
		return this.commands;
	}

	private contextToObject(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext): Object {
		let parsedObject: Object = {};
		if (!ctx || ctx.childCount === 0) { //Base case and malformed statements
			return parsedObject;
		}
		// In a well formed expression, Argument and propertyValue tokens should have exactly one child, from their definitions in mongo.g4
		// The only difference in types of children between PropertyValue and argument tokens is the functionCallContext that isn't handled at the moment.
		let child: ParseTree = ctx.children[0];
		if (child instanceof mongoParser.LiteralContext) {
			let text = child.text;
			let tokenType = child.start.type;
			const nonStringLiterals = [mongoParser.mongoParser.NullLiteral, mongoParser.mongoParser.BooleanLiteral, mongoParser.mongoParser.NumericLiteral];
			if (tokenType === mongoParser.mongoParser.StringLiteral) {
				parsedObject = stripQuotes(text);
			} else if (nonStringLiterals.indexOf(tokenType) > -1) {
				parsedObject = JSON.parse(text);
			} else {
				throw new Error(`Unrecognized token. Token text: ${text}`);
			}
		}
		else if (child instanceof mongoParser.ObjectLiteralContext) {
			let propertyNameAndValue = findType(child.children, mongoParser.PropertyNameAndValueListContext);
			if (!propertyNameAndValue) { // Argument is {}
				return {};
			}
			else {
				//tslint:disable:no-non-null-assertion
				let propertyAssignments = filterType(propertyNameAndValue.children, mongoParser.PropertyAssignmentContext);
				for (let propertyAssignment of propertyAssignments) {
					const propertyName = <mongoParser.PropertyNameContext>propertyAssignment.children[0];
					const propertyValue = <mongoParser.PropertyValueContext>propertyAssignment.children[2];
					parsedObject[stripQuotes(propertyName.text)] = this.contextToObject(propertyValue);
				}
			}
		}
		else if (child instanceof mongoParser.ArrayLiteralContext) {
			let elementList = findType(child.children, mongoParser.ElementListContext);
			if (elementList) {
				let elementItems = filterType(elementList.children, mongoParser.PropertyValueContext);
				parsedObject = elementItems.map(this.contextToObject.bind(this));
			} else {
				parsedObject = [];
			}
		} else if (child instanceof mongoParser.FunctionCallContext) {
			return {};
		} else {
			console.assert(false, "Unrecognized child type in parse tree.");
		}

		return parsedObject;
	}

}
