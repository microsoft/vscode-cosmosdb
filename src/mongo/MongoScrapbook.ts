/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { ObjectID } from 'bson';
import * as vscode from 'vscode';
import { IActionContext, IParsedError, parseError } from 'vscode-azureextensionui';
import { CosmosEditorManager } from '../CosmosEditorManager';
import { ext } from '../extensionVariables';
import { filterType, findType } from '../utils/array';
import * as vscodeUtil from './../utils/vscodeUtils';
import { MongoFindOneResultEditor } from './editors/MongoFindOneResultEditor';
import { MongoFindResultEditor } from './editors/MongoFindResultEditor';
import { LexerErrorListener, ParserErrorListener } from './errorListeners';
import { mongoLexer } from './grammar/mongoLexer';
import * as mongoParser from './grammar/mongoParser';
import { MongoVisitor } from './grammar/visitors';
import { ErrorDescription, MongoCommand } from './MongoCommand';
import { MongoDatabaseTreeItem, stripQuotes } from './tree/MongoDatabaseTreeItem';
// tslint:disable:no-var-requires
const EJSON = require("mongodb-extended-json");

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

export async function executeAllCommandsFromActiveEditor(database: MongoDatabaseTreeItem, extensionPath, editorManager: CosmosEditorManager, context: IActionContext): Promise<void> {
	ext.outputChannel.appendLine("Running all commands in scrapbook...");
	let commands = getAllCommandsFromActiveEditor();
	await executeCommands(vscode.window.activeTextEditor, database, extensionPath, editorManager, context, commands);
}

export async function executeCommandFromActiveEditor(database: MongoDatabaseTreeItem, extensionPath, editorManager: CosmosEditorManager, context: IActionContext): Promise<void> {
	const commands = getAllCommandsFromActiveEditor();
	const activeEditor = vscode.window.activeTextEditor;
	const selection = activeEditor.selection;
	const command = findCommandAtPosition(commands, selection.start);
	return await executeCommand(activeEditor, database, extensionPath, editorManager, context, command);
}

export async function executeCommandFromText(database: MongoDatabaseTreeItem, extensionPath, editorManager: CosmosEditorManager, context: IActionContext, commandText: string): Promise<void> {
	const activeEditor = vscode.window.activeTextEditor;
	const command = getCommandFromTextAtLocation(commandText, new vscode.Position(0, 0));
	return await executeCommand(activeEditor, database, extensionPath, editorManager, context, command);
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
	return getAllCommandsFromText(document.getText());
}

async function executeCommands(activeEditor: vscode.TextEditor, database: MongoDatabaseTreeItem, extensionPath, editorManager: CosmosEditorManager, context: IActionContext, commands: MongoCommand[]): Promise<void> {
	for (let command of commands) {
		try {
			await executeCommand(activeEditor, database, extensionPath, editorManager, context, command);
		} catch (e) {
			const err = parseError(e);
			if (err.isUserCancelledError) {
				throw e;
			} else {
				let message = `${command.text.split('(')[0]} at ${command.range.start.line + 1}:${command.range.start.character + 1}: ${err.message}`;
				throw new Error(message);
			}
		}
	}
}

async function executeCommand(activeEditor: vscode.TextEditor, database: MongoDatabaseTreeItem, extensionPath, editorManager: CosmosEditorManager, context: IActionContext, command: MongoCommand): Promise<void> {
	if (command) {
		ext.outputChannel.appendLine(command.text);

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
			await editorManager.showDocument(new MongoFindResultEditor(database, command), 'cosmos-result.json', { showInNextColumn: true });
		} else {
			const result = await database.executeCommand(command, context);
			if (command.name === 'findOne') {
				if (result === "null") {
					throw new Error(`Could not find any documents`);
				}
				await editorManager.showDocument(new MongoFindOneResultEditor(database, command.collection, result), 'cosmos-result.json', { showInNextColumn: true });
			} else {
				await vscodeUtil.showNewFile(result, extensionPath, 'result', '.json', activeEditor.viewColumn + 1);
				await refreshTreeAfterCommand(database, command);
			}
		}
	} else {
		throw new Error('No MongoDB command found at the current cursor location.');
	}
}

async function refreshTreeAfterCommand(database: MongoDatabaseTreeItem, command: MongoCommand) {
	if (command.name === 'drop') {
		database.refresh();
	}
	else if (command.collection && /^(insert|update|delete|replace|remove|write|bulkWrite)/i.test(command.name)) {
		const collectionNode = await ext.tree.findTreeItem(database.fullId + "/" + command.collection);
		if (collectionNode) {
			collectionNode.refresh();
		}
	}
}

export function getCommandFromTextAtLocation(content: string, position?: vscode.Position): MongoCommand {
	let commands = getAllCommandsFromText(content);
	return findCommandAtPosition(commands, position);
}

export function getAllCommandsFromText(content: string): MongoCommand[] {
	const lexer = new mongoLexer(new InputStream(content));
	let lexerListener = new LexerErrorListener();
	lexer.removeErrorListeners(); // Default listener outputs to the console
	lexer.addErrorListener(lexerListener);
	let tokens: CommonTokenStream = new CommonTokenStream(lexer);

	const parser = new mongoParser.mongoParser(tokens);
	let parserListener = new ParserErrorListener();
	parser.removeErrorListeners(); // Default listener outputs to the console
	parser.addErrorListener(parserListener);

	let commandsContext: mongoParser.MongoCommandsContext = parser.mongoCommands();
	const commands = new FindMongoCommandsVisitor().visit(commandsContext);

	// Match errors with commands based on location
	let errors = lexerListener.errors.concat(parserListener.errors);
	errors.sort((a, b) => {
		let linediff = a.range.start.line - b.range.start.line;
		let chardiff = a.range.start.character - b.range.start.character;
		return linediff || chardiff;
	});
	for (let err of errors) {
		let associatedCommand = findCommandAtPosition(commands, err.range.start);
		if (associatedCommand) {
			associatedCommand.errors = associatedCommand.errors || [];
			associatedCommand.errors.push(err);
		} else {
			// Create a new command to hook this up to
			let emptyCommand: MongoCommand = {
				collection: undefined,
				name: undefined,
				range: err.range,
				text: ""
			};
			emptyCommand.errors = [err];
			commands.push(emptyCommand);
		}
	}

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

class FindMongoCommandsVisitor extends MongoVisitor<MongoCommand[]> {
	private commands: MongoCommand[] = [];

	visitCommand(ctx: mongoParser.CommandContext): MongoCommand[] {
		let funcCallCount: number = filterType(ctx.children, mongoParser.FunctionCallContext).length;
		this.commands.push({
			range: new vscode.Range(ctx.start.line - 1, ctx.start.charPositionInLine, ctx.stop.line - 1, ctx.stop.charPositionInLine),
			text: ctx.text,
			name: '',
			arguments: [],
			argumentObjects: [],
			chained: funcCallCount > 1 ? true : false
		});
		return super.visitCommand(ctx);
	}

	visitCollection(ctx: mongoParser.CollectionContext): MongoCommand[] {
		this.commands[this.commands.length - 1].collection = ctx.text;
		return super.visitCollection(ctx);
	}

	visitFunctionCall(ctx: mongoParser.FunctionCallContext): MongoCommand[] {
		if (ctx.parent instanceof mongoParser.CommandContext) {
			this.commands[this.commands.length - 1].name = (ctx._FUNCTION_NAME && ctx._FUNCTION_NAME.text) || "";
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
				const argText = EJSON.stringify(argAsObject);
				lastCommand.arguments.push(argText);
				let escapeHandled = this.deduplicateEscapesForRegex(argText);
				let ejsonParsed = {};
				try {
					ejsonParsed = EJSON.parse(escapeHandled);
				} catch (err) { //EJSON parse failed due to a wrong flag, etc.
					this.addErrorToCommand(parseError(err), ctx);
				}
				lastCommand.argumentObjects.push(ejsonParsed);
			}
		}
		return super.visitArgument(ctx);
	}

	protected defaultResult(_node: ParseTree): MongoCommand[] {
		return this.commands;
	}

	private contextToObject(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext): Object {
		if (!ctx || ctx.childCount === 0) { //Base case and malformed statements
			return {};
		}
		// In a well formed expression, Argument and propertyValue tokens should have exactly one child, from their definitions in mongo.g4
		let child: ParseTree = ctx.children[0];
		if (child instanceof mongoParser.LiteralContext) {
			return this.literalContextToObject(child, ctx);
		} else if (child instanceof mongoParser.ObjectLiteralContext) {
			return this.objectLiteralContextToObject(child);
		} else if (child instanceof mongoParser.ArrayLiteralContext) {
			return this.arrayLiteralContextToObject(child);
		} else if (child instanceof mongoParser.FunctionCallContext) {
			return this.functionCallContextToObject(child, ctx);
		} else if (child instanceof ErrorNode) {
			return {};
		} else {
			let err: IParsedError = parseError(`Unrecognized node type encountered. We could not parse ${child.text}`);
			this.addErrorToCommand(err, ctx);
			return {};
		}
	}

	private literalContextToObject(child: mongoParser.LiteralContext, ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext): Object {
		let text = child.text;
		let tokenType = child.start.type;
		const nonStringLiterals = [mongoParser.mongoParser.NullLiteral, mongoParser.mongoParser.BooleanLiteral, mongoParser.mongoParser.NumericLiteral];
		if (tokenType === mongoParser.mongoParser.StringLiteral) {
			return stripQuotes(text);
		} else if (tokenType === mongoParser.mongoParser.RegexLiteral) {
			return this.regexLiteralContextToObject(ctx, text);
		} else if (nonStringLiterals.indexOf(tokenType) > -1) {
			return JSON.parse(text);
		} else {
			let err: IParsedError = parseError(`Unrecognized token. Token text: ${text}`);
			this.addErrorToCommand(err, ctx);
			return {};
		}
	}

	private objectLiteralContextToObject(child: mongoParser.ObjectLiteralContext): Object {
		let propertyNameAndValue = findType(child.children, mongoParser.PropertyNameAndValueListContext);
		if (!propertyNameAndValue) { // Argument is {}
			return {};
		}
		else {
			let parsedObject: Object = {};
			//tslint:disable:no-non-null-assertion
			let propertyAssignments = filterType(propertyNameAndValue.children, mongoParser.PropertyAssignmentContext);
			for (let propertyAssignment of propertyAssignments) {
				const propertyName = <mongoParser.PropertyNameContext>propertyAssignment.children[0];
				const propertyValue = <mongoParser.PropertyValueContext>propertyAssignment.children[2];
				parsedObject[stripQuotes(propertyName.text)] = this.contextToObject(propertyValue);
			}
			return parsedObject;
		}
	}

	private arrayLiteralContextToObject(child: mongoParser.ArrayLiteralContext) {
		let elementList = findType(child.children, mongoParser.ElementListContext);
		if (elementList) {
			let elementItems = filterType(elementList.children, mongoParser.PropertyValueContext);
			return elementItems.map(this.contextToObject.bind(this));
		}
		else {
			return [];
		}
	}

	private functionCallContextToObject(child: mongoParser.FunctionCallContext, ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext): Object {
		let functionTokens = child.children;
		let constructorCall: TerminalNode = findType(functionTokens, TerminalNode);
		let argumentsToken: mongoParser.ArgumentsContext = findType(functionTokens, mongoParser.ArgumentsContext);
		if (!(argumentsToken._CLOSED_PARENTHESIS && argumentsToken._OPEN_PARENTHESIS)) { //argumentsToken does not have '(' or ')'
			let err: IParsedError = parseError(`Expecting parentheses or quotes at '${constructorCall.text}'`);
			this.addErrorToCommand(err, ctx);
			return {};
		}
		let argumentContextArray: mongoParser.ArgumentContext[] = filterType(argumentsToken.children, mongoParser.ArgumentContext);

		let functionMap = { "ObjectId": this.objectIdToObject, "ISODate": this.dateToObject, "Date": this.dateToObject };
		if (argumentContextArray.length > 1) {
			let err: IParsedError = parseError(`Too many arguments. Expecting 0 or 1 argument(s) to ${constructorCall}`);
			this.addErrorToCommand(err, ctx);
			return {};
		}
		if (constructorCall.text in functionMap) {
			let args = [ctx, argumentContextArray.length ? argumentContextArray[0].text : undefined];
			return functionMap[constructorCall.text].apply(this, args);
		}
		let unrecognizedNodeErr: IParsedError = parseError(`Unrecognized node type encountered. Could not parse ${constructorCall.text} as part of ${child.text}`);
		this.addErrorToCommand(unrecognizedNodeErr, ctx);
		return {};
	}

	private dateToObject(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext, tokenText?: string): Object {
		let constructedObject: Date;
		if (!tokenText) { // usage : ObjectID()
			constructedObject = new Date();
		} else {
			try {
				constructedObject = new Date(stripQuotes(tokenText));
			} catch (error) {
				let err: IParsedError = parseError(error);
				this.addErrorToCommand(err, ctx);
				return {};
			}
		}
		return { $date: constructedObject.toString() };
	}

	private objectIdToObject(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext, tokenText?: string): Object {
		let hexID: string;
		let constructedObject: ObjectID;
		if (!tokenText) { // usage : ObjectID()
			constructedObject = new ObjectID();
		} else {
			hexID = stripQuotes(<string>tokenText);
			try {
				constructedObject = new ObjectID(hexID);
			} catch (error) {
				let err: IParsedError = parseError(error);
				this.addErrorToCommand(err, ctx);
				return {};
			}
		}
		return { $oid: constructedObject.toString() };
	}

	private regexLiteralContextToObject(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext, text: string): Object {
		let separator = text.lastIndexOf('/');
		let flags = separator !== text.length - 1 ? text.substring(separator + 1) : "";
		let pattern = text.substring(1, separator);
		try {
			// validate the pattern and flags.
			// It is intended for the errors thrown here to be handled by the catch block.
			let tokenObject = new RegExp(pattern, flags);
			tokenObject = tokenObject;
			// we are passing back a $regex annotation, hence we ensure parity wit the $regex syntax
			return { $regex: this.regexToStringNotation(pattern), $options: flags };
		} catch (error) { //User may not have finished typing
			let err: IParsedError = parseError(error);
			this.addErrorToCommand(err, ctx);
			return {};
		}
	}

	private addErrorToCommand(error: { message: string }, ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext): void {
		let command = this.commands[this.commands.length - 1];
		command.errors = command.errors || [];
		let currentErrorDesc: ErrorDescription = { message: error.message, range: new vscode.Range(ctx.start.line - 1, ctx.start.charPositionInLine, ctx.stop.line - 1, ctx.stop.charPositionInLine) };
		command.errors.push(currentErrorDesc);
	}

	private regexToStringNotation(pattern: string): string {
		// The equivalence:
		// /ker\b/ <=> $regex: "ker\\b", /ker\\b/ <=> "ker\\\\b"
		return pattern.replace(/\\([0-9a-z.*])/i, '\\\\$1');
	}

	private deduplicateEscapesForRegex(argAsString: string) {
		let removeDuplicatedBackslash = /\\{4}([0-9a-z.*])/gi;
		/*
		We remove duplicate backslashes due the behavior of '\b' - \b in a regex denotes word boundary, while \b in a string denotes backspace.
		$regex syntax uses a string. Strings require slashes to be escaped, while /regex/ does not. Eg. /abc+\b/ is equivalent to {$regex: "abc+\\b"}.
		{$regex: "abc+\b"} with an unescaped slash gets parsed as  {$regex: <EOF>}. The user can only type '\\b' (which is encoded as '\\\\b').
		We need to convert this appropriately. Other special characters (\n, \t, \r) don't carry significance in regexes - we don't handle those
		What the regex does: '\\{4}' looks for the escaped slash 4 times. Lookahead checks if the character being escaped has a special meaning.
		*/
		let escapeHandled = argAsString.replace(removeDuplicatedBackslash, `\\\\$1`);
		return escapeHandled;
	}

}
