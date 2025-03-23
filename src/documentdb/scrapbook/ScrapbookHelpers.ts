/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError, type IParsedError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';
import { type ParseTree } from 'antlr4ts/tree/ParseTree';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { EJSON, ObjectId } from 'bson';
import * as vscode from 'vscode';
import { filterType, findType } from '../../utils/array';
import { nonNullProp, nonNullValue } from '../../utils/nonNull';
import { mongoLexer } from '../grammar/mongoLexer';
import * as mongoParser from '../grammar/mongoParser';
import { MongoVisitor } from '../grammar/visitors';
import { LexerErrorListener, ParserErrorListener } from './errorListeners';
import { type ErrorDescription, type MongoCommand } from './MongoCommand';

export function stripQuotes(term: string): string {
    if ((term.startsWith("'") && term.endsWith("'")) || (term.startsWith('"') && term.endsWith('"'))) {
        return term.substring(1, term.length - 1);
    }
    return term;
}

export function getAllErrorsFromTextDocument(document: vscode.TextDocument): vscode.Diagnostic[] {
    const commands = getAllCommandsFromText(document.getText());
    const errors: vscode.Diagnostic[] = [];
    for (const command of commands) {
        for (const error of command.errors || []) {
            const diagnostic = new vscode.Diagnostic(error.range, error.message);
            errors.push(diagnostic);
        }
    }

    return errors;
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
                text: '',
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
            range: new vscode.Range(
                ctx.start.line - 1,
                ctx.start.charPositionInLine,
                stop.line - 1,
                stop.charPositionInLine,
            ),
            text: ctx.text,
            name: '',
            arguments: [],
            argumentObjects: [],
            chained: funcCallCount > 1 ? true : false,
        });
        return super.visitCommand(ctx);
    }

    public visitCollection(ctx: mongoParser.CollectionContext): MongoCommand[] {
        this.commands[this.commands.length - 1].collection = ctx.text;
        return super.visitCollection(ctx);
    }

    public visitFunctionCall(ctx: mongoParser.FunctionCallContext): MongoCommand[] {
        if (ctx.parent instanceof mongoParser.CommandContext) {
            this.commands[this.commands.length - 1].name = (ctx._FUNCTION_NAME && ctx._FUNCTION_NAME.text) || '';
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
                    } catch (error) {
                        //EJSON parse failed due to a wrong flag, etc.
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

    //eslint-disable-next-line  @typescript-eslint/no-wrapper-object-types
    private contextToObject(ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext): Object {
        if (!ctx || ctx.childCount === 0) {
            //Base case and malformed statements
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
            this.addErrorToCommand(
                l10n.t('Unrecognized node type encountered. We could not parse {text}', { text: child.text }),
                ctx,
            );
            return {};
        }
    }

    private literalContextToObject(
        child: mongoParser.LiteralContext,
        ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext,
        //eslint-disable-next-line  @typescript-eslint/no-wrapper-object-types
    ): Object {
        const text = child.text;
        const tokenType = child.start.type;
        const nonStringLiterals = [
            mongoParser.mongoParser.NullLiteral,
            mongoParser.mongoParser.BooleanLiteral,
            mongoParser.mongoParser.NumericLiteral,
        ];
        if (tokenType === mongoParser.mongoParser.StringLiteral) {
            return stripQuotes(text);
        } else if (tokenType === mongoParser.mongoParser.RegexLiteral) {
            return this.regexLiteralContextToObject(ctx, text);
        } else if (nonStringLiterals.indexOf(tokenType) > -1) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-return
            return JSON.parse(text);
        } else {
            this.addErrorToCommand(l10n.t('Unrecognized token. Token text: {text}', { text }), ctx);
            return {};
        }
    }

    private objectLiteralContextToObject(child: mongoParser.ObjectLiteralContext): object {
        const propertyNameAndValue = findType(child.children, mongoParser.PropertyNameAndValueListContext);
        if (!propertyNameAndValue) {
            // Argument is {}
            return {};
        } else {
            const parsedObject: object = {};
            const propertyAssignments = filterType(
                propertyNameAndValue.children,
                mongoParser.PropertyAssignmentContext,
            );
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
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            return elementItems.map(this.contextToObject.bind(this));
        } else {
            return [];
        }
    }

    private functionCallContextToObject(
        child: mongoParser.FunctionCallContext,
        ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext,
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    ): Object {
        const functionTokens = child.children;
        const constructorCall: TerminalNode = nonNullValue(findType(functionTokens, TerminalNode), 'constructorCall');
        const argumentsToken: mongoParser.ArgumentsContext = nonNullValue(
            findType(functionTokens, mongoParser.ArgumentsContext),
            'argumentsToken',
        );
        if (!(argumentsToken._CLOSED_PARENTHESIS && argumentsToken._OPEN_PARENTHESIS)) {
            //argumentsToken does not have '(' or ')'
            this.addErrorToCommand(
                l10n.t('Expecting parentheses or quotes at "{text}"', { text: constructorCall.text }),
                ctx,
            );
            return {};
        }

        const argumentContextArray: mongoParser.ArgumentContext[] = filterType(
            argumentsToken.children,
            mongoParser.ArgumentContext,
        );
        if (argumentContextArray.length > 1) {
            this.addErrorToCommand(
                l10n.t('Too many arguments. Expecting 0 or 1 argument(s) to {constructorCall}', {
                    constructorCall: constructorCall.text,
                }),
                ctx,
            );
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
                this.addErrorToCommand(
                    l10n.t(
                        'Unrecognized node type encountered. Could not parse {constructorCall} as part of {functionCall}',
                        { constructorCall: constructorCall.text, functionCall: child.text },
                    ),
                    ctx,
                );
                return {};
        }
    }

    private dateToObject(
        ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext,
        tokenText?: string,
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    ): { $date: string } | Object {
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
        const date: Date | Object = this.tryToConstructDate(ctx, tokenText);
        if (date instanceof Date) {
            return { $date: date.toString() };
        } else {
            return date;
        }
    }

    private isodateToObject(
        ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext,
        tokenText?: string,
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    ): { $date: string } | Object {
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
        const date: Date | Object = this.tryToConstructDate(ctx, tokenText, true);

        if (date instanceof Date) {
            return { $date: date.toISOString() };
        } else {
            return date;
        }
    }

    private tryToConstructDate(
        ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext,
        tokenText?: string,
        isIsodate: boolean = false,
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    ): Date | Object {
        if (!tokenText) {
            // usage : ObjectID()
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

    private objectIdToObject(
        ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext,
        tokenText?: string,
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    ): Object {
        let hexID: string;
        let constructedObject: ObjectId;
        if (!tokenText) {
            // usage : ObjectID()
            constructedObject = new ObjectId();
        } else {
            hexID = stripQuotes(<string>tokenText);
            try {
                constructedObject = new ObjectId(hexID);
            } catch (error) {
                const parsedError: IParsedError = parseError(error);
                this.addErrorToCommand(parsedError.message, ctx);
                return {};
            }
        }
        return { $oid: constructedObject.toString() };
    }

    private regexLiteralContextToObject(
        ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext,
        text: string,
        // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
    ): Object {
        const separator = text.lastIndexOf('/');
        const flags = separator !== text.length - 1 ? text.substring(separator + 1) : '';
        const pattern = text.substring(1, separator);
        try {
            // validate the pattern and flags.
            // It is intended for the errors thrown here to be handled by the catch block.
            new RegExp(pattern, flags);
            // we are passing back a $regex annotation, hence we ensure parity wit the $regex syntax
            return { $regex: this.regexToStringNotation(pattern), $options: flags };
        } catch (error) {
            //User may not have finished typing
            const parsedError: IParsedError = parseError(error);
            this.addErrorToCommand(parsedError.message, ctx);
            return {};
        }
    }

    private addErrorToCommand(
        errorMessage: string,
        ctx: mongoParser.ArgumentContext | mongoParser.PropertyValueContext,
    ): void {
        const command = this.commands[this.commands.length - 1];
        command.errors = command.errors || [];
        const stop = nonNullProp(ctx, 'stop');
        const currentErrorDesc: ErrorDescription = {
            message: errorMessage,
            range: new vscode.Range(
                ctx.start.line - 1,
                ctx.start.charPositionInLine,
                stop.line - 1,
                stop.charPositionInLine,
            ),
        };
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
        return argAsString.replace(removeDuplicatedBackslash, '\\\\$1');
    }
}
