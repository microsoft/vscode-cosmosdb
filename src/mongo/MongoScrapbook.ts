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
import { Collection } from 'mongodb';
import { EOL } from 'os';
import * as vscode from 'vscode';
import { IActionContext, IParsedError, openReadOnlyContent, parseError, ReadOnlyContent } from 'vscode-azureextensionui';
import { ext } from '../extensionVariables';
import { filterType, findType } from '../utils/array';
import { localize } from '../utils/localize';
import { nonNullProp, nonNullValue } from '../utils/nonNull';
import { LexerErrorListener, ParserErrorListener } from './errorListeners';
import { mongoLexer } from './grammar/mongoLexer';
import * as mongoParser from './grammar/mongoParser';
import { MongoVisitor } from './grammar/visitors';
import { ErrorDescription, MongoCommand } from './MongoCommand';
import { MongoCollectionTreeItem } from './tree/MongoCollectionTreeItem';
import { MongoDatabaseTreeItem, stripQuotes } from './tree/MongoDatabaseTreeItem';
import { IMongoDocument, MongoDocumentTreeItem } from './tree/MongoDocumentTreeItem';
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-var-requires
const EJSON = require("mongodb-extended-json");

const notInScrapbookMessage = "You must have a MongoDB scrapbook (*.mongo) open to run a MongoDB command.";

export function getAllErrorsFromTextDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
    const commands = getAllCommandsFromTextDocument(document);
    const errors: vscode.Diagnostic[] = [];
    for (const command of commands) {
        for (const error of (command.errors || [])) {
            const diagnostic = new vscode.Diagnostic(error.range, error.message);
            errors.push(diagnostic);
        }
    }

    return errors;
}

export async function executeAllCommandsFromActiveEditor(context: IActionContext): Promise<void> {
    ext.outputChannel.appendLog("Executing all commands in scrapbook...");
    const commands = getAllCommandsFromActiveEditor();
    await executeCommands(context, commands);
}

export async function executeCommandFromActiveEditor(context: IActionContext, position?: vscode.Position): Promise<void> {
    const commands = getAllCommandsFromActiveEditor();
    const command = findCommandAtPosition(commands, position || vscode.window.activeTextEditor?.selection.start);
    return await executeCommand(context, command);
}

function getAllCommandsFromActiveEditor(): MongoCommand[] {
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor) {
        return getAllCommandsFromTextDocument(activeEditor.document);
    } else {
        // Shouldn't be able to reach this
        throw new Error(notInScrapbookMessage);
    }
}

export function getAllCommandsFromTextDocument(document: vscode.TextDocument): MongoCommand[] {
    return getAllCommandsFromText(document.getText());
}

async function executeCommands(context: IActionContext, commands: MongoCommand[]): Promise<void> {
    const label: string = 'Scrapbook-execute-all-results';
    const fullId: string = `${ext.connectedMongoDB?.fullId}/${label}`;
    const readOnlyContent: ReadOnlyContent = await openReadOnlyContent({ label, fullId }, '', '.txt', { viewColumn: vscode.ViewColumn.Beside });

    for (const command of commands) {
        try {
            await executeCommand(context, command, readOnlyContent);
        } catch (e) {
            const err = parseError(e);
            if (err.isUserCancelledError) {
                throw e;
            } else {
                const message = `${command.text.split('(')[0]} at ${command.range.start.line + 1}:${command.range.start.character + 1}: ${err.message}`;
                throw new Error(message);
            }
        }
    }
}

async function executeCommand(context: IActionContext, command: MongoCommand, readOnlyContent?: ReadOnlyContent): Promise<void> {
    if (command) {
        try {
            context.telemetry.properties.command = command.name;
            context.telemetry.properties.argsCount = String(command.arguments ? command.arguments.length : 0);
        } catch (error) {
            // Ignore
        }

        const database = ext.connectedMongoDB;
        if (!database) {
            throw new Error('Please select a MongoDB database to run against by selecting it in the explorer and selecting the "Connect" context menu item');
        }
        if (command.errors && command.errors.length > 0) {
            //Currently, we take the first error pushed. Tests correlate that the parser visits errors in left-to-right, top-to-bottom.
            const err = command.errors[0];
            throw new Error(localize('unableToParseSyntax', `Unable to parse syntax. Error near line ${err.range.start.line + 1}, column ${err.range.start.character + 1}: "${err.message}"`));
        }

        // we don't handle chained commands so we can only handle "find" if isn't chained
        if (command.name === 'find' && !command.chained) {
            const db = await database.connectToDb();
            const collectionName: string = nonNullProp(command, 'collection');
            const collection: Collection = db.collection(collectionName);
            // NOTE: Intentionally creating a _new_ tree item rather than searching for a cached node in the tree because
            // the executed 'find' command could have a filter or projection that is not handled by a cached tree node
            const node = new MongoCollectionTreeItem(database, collection, command.argumentObjects);
            await ext.fileSystem.showTextDocument(node, { viewColumn: vscode.ViewColumn.Beside });
        } else {
            const result = await database.executeCommand(command, context);
            if (command.name === 'findOne') {
                if (result === "null") {
                    throw new Error(`Could not find any documents`);
                }

                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
                const document: IMongoDocument = EJSON.parse(result);
                const collectionName: string = nonNullProp(command, 'collection');

                const collectionId: string = `${database.fullId}/${collectionName}`;
                const colNode: MongoCollectionTreeItem | undefined = await ext.tree.findTreeItem(collectionId, context);
                if (!colNode) {
                    throw new Error(localize('failedToFind', 'Failed to find collection "{0}".', collectionName));
                }
                const docNode = new MongoDocumentTreeItem(colNode, document);
                await ext.fileSystem.showTextDocument(docNode, { viewColumn: vscode.ViewColumn.Beside });
            } else {
                if (readOnlyContent) {
                    await readOnlyContent.append(`${result}${EOL}${EOL}`);
                } else {
                    const label: string = 'Scrapbook-results';
                    const fullId: string = `${database.fullId}/${label}`;
                    await openReadOnlyContent({ label, fullId }, result, '.json', { viewColumn: vscode.ViewColumn.Beside });
                }

                await refreshTreeAfterCommand(database, command, context);
            }
        }
    } else {
        throw new Error('No MongoDB command found at the current cursor location.');
    }
}

async function refreshTreeAfterCommand(database: MongoDatabaseTreeItem, command: MongoCommand, context: IActionContext): Promise<void> {
    if (command.name === 'drop') {
        await database.refresh(context);
    } else if (command.collection && command.name && /^(insert|update|delete|replace|remove|write|bulkWrite)/i.test(command.name)) {
        const collectionNode = await ext.tree.findTreeItem(database.fullId + "/" + command.collection, context);
        if (collectionNode) {
            await collectionNode.refresh(context);
        }
    }
}

export function getAllCommandsFromText(content: string): MongoCommand[] {
    const lexer = new mongoLexer(new InputStream(content));
    const lexerListener = new LexerErrorListener();
    lexer.removeErrorListeners(); // Default listener outputs to the console
    lexer.addErrorListener(lexerListener);
    const tokens: CommonTokenStream = new CommonTokenStream(lexer);

    const parser = new mongoParser.mongoParser(tokens);
    const parserListener = new ParserErrorListener();
    parser.removeErrorListeners(); // Default listener outputs to the console
    parser.addErrorListener(parserListener);

    const commandsContext: mongoParser.MongoCommandsContext = parser.mongoCommands();
    const commands = new FindMongoCommandsVisitor().visit(commandsContext);

    // Match errors with commands based on location
    const errors = lexerListener.errors.concat(parserListener.errors);
    errors.sort((a, b) => {
        const linediff = a.range.start.line - b.range.start.line;
        const chardiff = a.range.start.character - b.range.start.character;
        return linediff || chardiff;
    });
    for (const err of errors) {
        const associatedCommand = findCommandAtPosition(commands, err.range.start);
        if (associatedCommand) {
            associatedCommand.errors = associatedCommand.errors || [];
            associatedCommand.errors.push(err);
        } else {
            // Create a new command to hook this up to
            const emptyCommand: MongoCommand = {
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

export function findCommandAtPosition(commands: MongoCommand[], position?: vscode.Position): MongoCommand {
    let lastCommandOnSameLine: MongoCommand | undefined;
    let lastCommandBeforePosition: MongoCommand | undefined;
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

    public visitCommand(ctx: mongoParser.CommandContext): MongoCommand[] {
        const funcCallCount: number = filterType(ctx.children, mongoParser.FunctionCallContext).length;
        const stop = nonNullProp(ctx, 'stop');
        this.commands.push({
            range: new vscode.Range(ctx.start.line - 1, ctx.start.charPositionInLine, stop.line - 1, stop.charPositionInLine),
            text: ctx.text,
            name: '',
            arguments: [],
            argumentObjects: [],
            chained: funcCallCount > 1 ? true : false
        });
        return super.visitCommand(ctx);
    }

    public visitCollection(ctx: mongoParser.CollectionContext): MongoCommand[] {
        this.commands[this.commands.length - 1].collection = ctx.text;
        return super.visitCollection(ctx);
    }

    public visitFunctionCall(ctx: mongoParser.FunctionCallContext): MongoCommand[] {
        if (ctx.parent instanceof mongoParser.CommandContext) {
            this.commands[this.commands.length - 1].name = (ctx._FUNCTION_NAME && ctx._FUNCTION_NAME.text) || "";
        }
        return super.visitFunctionCall(ctx);
    }

    public visitArgument(ctx: mongoParser.ArgumentContext): MongoCommand[] {
        try {
            const argumentsContext = ctx.parent;
            if (argumentsContext) {
                const functionCallContext = argumentsContext.parent;
                if (functionCallContext && functionCallContext.parent instanceof mongoParser.CommandContext) {
                    const lastCommand = this.commands[this.commands.length - 1];
                    const argAsObject = this.contextToObject(ctx);
                    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                    const argText = EJSON.stringify(argAsObject);
                    nonNullProp(lastCommand, 'arguments').push(argText);
                    const escapeHandled = this.deduplicateEscapesForRegex(argText);
                    let ejsonParsed = {};
                    try {
                        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
                        ejsonParsed = EJSON.parse(escapeHandled);
                    } catch (error) { //EJSON parse failed due to a wrong flag, etc.
                        const parsedError: IParsedError = parseError(error);
                        this.addErrorToCommand(parsedError.message, ctx);
                    }
                    nonNullProp(lastCommand, 'argumentObjects').push(ejsonParsed);
                }
            }
        } catch (error) {
            const parsedError: IParsedError = parseError(error);
            this.addErrorToCommand(parsedError.message, ctx);
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
        const child: ParseTree = nonNullProp(ctx, 'children')[0];
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
            this.addErrorToCommand(`Unrecognized node type encountered. We could not parse ${child.text}`, ctx);
            return {};
        }
    }

    private literalContextToObject(child: mongoParser.LiteralContext, ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext): Object {
        const text = child.text;
        const tokenType = child.start.type;
        const nonStringLiterals = [mongoParser.mongoParser.NullLiteral, mongoParser.mongoParser.BooleanLiteral, mongoParser.mongoParser.NumericLiteral];
        if (tokenType === mongoParser.mongoParser.StringLiteral) {
            return stripQuotes(text);
        } else if (tokenType === mongoParser.mongoParser.RegexLiteral) {
            return this.regexLiteralContextToObject(ctx, text);
        } else if (nonStringLiterals.indexOf(tokenType) > -1) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return JSON.parse(text);
        } else {
            this.addErrorToCommand(`Unrecognized token. Token text: ${text}`, ctx);
            return {};
        }
    }

    private objectLiteralContextToObject(child: mongoParser.ObjectLiteralContext): Object {
        const propertyNameAndValue = findType(child.children, mongoParser.PropertyNameAndValueListContext);
        if (!propertyNameAndValue) { // Argument is {}
            return {};
        } else {
            const parsedObject: Object = {};
            const propertyAssignments = filterType(propertyNameAndValue.children, mongoParser.PropertyAssignmentContext);
            for (const propertyAssignment of propertyAssignments) {
                const propertyAssignmentChildren = nonNullProp(propertyAssignment, 'children');
                const propertyName = <mongoParser.PropertyNameContext>propertyAssignmentChildren[0];
                const propertyValue = <mongoParser.PropertyValueContext>propertyAssignmentChildren[2];
                parsedObject[stripQuotes(propertyName.text)] = this.contextToObject(propertyValue);
            }
            return parsedObject;
        }
    }

    private arrayLiteralContextToObject(child: mongoParser.ArrayLiteralContext) {
        const elementList = findType(child.children, mongoParser.ElementListContext);
        if (elementList) {
            const elementItems = filterType(elementList.children, mongoParser.PropertyValueContext);
            return elementItems.map(this.contextToObject.bind(this));
        } else {
            return [];
        }
    }

    private functionCallContextToObject(child: mongoParser.FunctionCallContext, ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext): Object {
        const functionTokens = child.children;
        const constructorCall: TerminalNode = nonNullValue(findType(functionTokens, TerminalNode), 'constructorCall');
        const argumentsToken: mongoParser.ArgumentsContext = nonNullValue(findType(functionTokens, mongoParser.ArgumentsContext), 'argumentsToken');
        if (!(argumentsToken._CLOSED_PARENTHESIS && argumentsToken._OPEN_PARENTHESIS)) { //argumentsToken does not have '(' or ')'
            this.addErrorToCommand(`Expecting parentheses or quotes at '${constructorCall.text}'`, ctx);
            return {};
        }

        const argumentContextArray: mongoParser.ArgumentContext[] = filterType(argumentsToken.children, mongoParser.ArgumentContext);
        if (argumentContextArray.length > 1) {
            this.addErrorToCommand(`Too many arguments. Expecting 0 or 1 argument(s) to ${constructorCall}`, ctx);
            return {};
        }

        const tokenText: string | undefined = argumentContextArray.length ? argumentContextArray[0].text : undefined;
        switch (constructorCall.text) {
            case 'ObjectId':
                return this.objectIdToObject(ctx, tokenText);
            case 'ISODate':
                return this.isodateToObject(ctx, tokenText);
            case 'Date':
                return this.dateToObject(ctx, tokenText);
            default:
                this.addErrorToCommand(`Unrecognized node type encountered. Could not parse ${constructorCall.text} as part of ${child.text}`, ctx);
                return {};
        }
    }

    private dateToObject(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext, tokenText?: string): { $date: string } | {} {
        const date: Date | {} = this.tryToConstructDate(ctx, tokenText);
        if (date instanceof Date) {
            return { $date: date.toString() };
        } else {
            return date;
        }
    }

    private isodateToObject(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext, tokenText?: string): { $date: string } | {} {
        const date: Date | {} = this.tryToConstructDate(ctx, tokenText, true);

        if (date instanceof Date) {
            return { $date: date.toISOString() };
        } else {
            return date;
        }
    }

    private tryToConstructDate(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext, tokenText?: string, isIsodate: boolean = false): Date | {} {
        if (!tokenText) { // usage : ObjectID()
            return new Date();
        } else {
            try {
                tokenText = stripQuotes(tokenText);

                // if the tokenText was an isodate, the last char must be Z
                if (isIsodate) {
                    if (tokenText[tokenText.length - 1] !== 'Z') {
                        tokenText += 'Z';
                    }
                }

                return new Date(tokenText);
            } catch (error) {
                const parsedError: IParsedError = parseError(error);
                this.addErrorToCommand(parsedError.message, ctx);
                return {};
            }
        }
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
                const parsedError: IParsedError = parseError(error);
                this.addErrorToCommand(parsedError.message, ctx);
                return {};
            }
        }
        return { $oid: constructedObject.toString() };
    }

    private regexLiteralContextToObject(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext, text: string): Object {
        const separator = text.lastIndexOf('/');
        const flags = separator !== text.length - 1 ? text.substring(separator + 1) : "";
        const pattern = text.substring(1, separator);
        try {
            // validate the pattern and flags.
            // It is intended for the errors thrown here to be handled by the catch block.
            let tokenObject = new RegExp(pattern, flags);
            // eslint-disable-next-line no-self-assign, @typescript-eslint/no-unused-vars
            tokenObject = tokenObject;
            // we are passing back a $regex annotation, hence we ensure parity wit the $regex syntax
            return { $regex: this.regexToStringNotation(pattern), $options: flags };
        } catch (error) { //User may not have finished typing
            const parsedError: IParsedError = parseError(error);
            this.addErrorToCommand(parsedError.message, ctx);
            return {};
        }
    }

    private addErrorToCommand(errorMessage: string, ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext): void {
        const command = this.commands[this.commands.length - 1];
        command.errors = command.errors || [];
        const stop = nonNullProp(ctx, 'stop');
        const currentErrorDesc: ErrorDescription = { message: errorMessage, range: new vscode.Range(ctx.start.line - 1, ctx.start.charPositionInLine, stop.line - 1, stop.charPositionInLine) };
        command.errors.push(currentErrorDesc);
    }

    private regexToStringNotation(pattern: string): string {
        // The equivalence:
        // /ker\b/ <=> $regex: "ker\\b", /ker\\b/ <=> "ker\\\\b"
        return pattern.replace(/\\([0-9a-z.*])/i, '\\\\$1');
    }

    private deduplicateEscapesForRegex(argAsString: string): string {
        const removeDuplicatedBackslash = /\\{4}([0-9a-z.*])/gi;
        /*
        We remove duplicate backslashes due the behavior of '\b' - \b in a regex denotes word boundary, while \b in a string denotes backspace.
        $regex syntax uses a string. Strings require slashes to be escaped, while /regex/ does not. Eg. /abc+\b/ is equivalent to {$regex: "abc+\\b"}.
        {$regex: "abc+\b"} with an unescaped slash gets parsed as  {$regex: <EOF>}. The user can only type '\\b' (which is encoded as '\\\\b').
        We need to convert this appropriately. Other special characters (\n, \t, \r) don't carry significance in regexes - we don't handle those
        What the regex does: '\\{4}' looks for the escaped slash 4 times. Lookahead checks if the character being escaped has a special meaning.
        */
        return argAsString.replace(removeDuplicatedBackslash, `\\\\$1`);
    }

}
