/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable @typescript-eslint/no-non-null-assertion */

import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';
import { type ParseTree } from 'antlr4ts/tree/ParseTree';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { type Db } from 'mongodb';
import { type LanguageService as JsonLanguageService } from 'vscode-json-languageservice';
import { CompletionItemKind, Position, Range, type CompletionItem } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { mongoLexer } from '../../grammar/mongoLexer';
import * as mongoParser from '../../grammar/mongoParser';
import { MongoVisitor } from '../../grammar/visitors';
import { type SchemaService } from './schemaService';

export class CompletionItemsVisitor extends MongoVisitor<Promise<CompletionItem[]>> {
    private at: Position;

    constructor(
        private textDocument: TextDocument,
        private db: Db,
        private offset: number,
        private schemaService: SchemaService,
        private jsonLanguageService: JsonLanguageService,
    ) {
        super();
        this.at = this.textDocument.positionAt(this.offset);
    }

    public visitCommands(ctx: mongoParser.CommandsContext): Promise<CompletionItem[]> {
        return this.thenable(this.createDbKeywordCompletion(this.createRange(ctx)));
    }

    public visitEmptyCommand(ctx: mongoParser.EmptyCommandContext): Promise<CompletionItem[]> {
        return this.thenable(this.createDbKeywordCompletion(this.createRangeAfter(ctx)));
    }

    public visitCommand(ctx: mongoParser.CommandContext): Promise<CompletionItem[]> {
        if (ctx.childCount === 0) {
            return this.thenable(this.createDbKeywordCompletion(this.createRange(ctx)));
        }

        const lastTerminalNode = this.getLastTerminalNode(ctx);
        if (lastTerminalNode) {
            return this.getCompletionItemsFromTerminalNode(lastTerminalNode);
        }
        return this.thenable();
    }

    public visitCollection(ctx: mongoParser.CollectionContext): Promise<CompletionItem[]> {
        return Promise.all([
            this.createCollectionCompletions(this.createRange(ctx)),
            this.createDbFunctionCompletions(this.createRange(ctx)),
        ]).then(([collectionCompletions, dbFunctionCompletions]) => [
            ...collectionCompletions,
            ...dbFunctionCompletions,
        ]);
    }

    public visitFunctionCall(ctx: mongoParser.FunctionCallContext): Promise<CompletionItem[]> {
        const previousNode = this.getPreviousNode(ctx);
        if (previousNode instanceof TerminalNode) {
            return this.getCompletionItemsFromTerminalNode(previousNode);
        }
        return this.thenable();
    }

    public visitArguments(ctx: mongoParser.ArgumentsContext): Promise<CompletionItem[]> {
        const terminalNode = this.getLastTerminalNode(ctx);
        if (terminalNode && terminalNode.symbol === ctx._CLOSED_PARENTHESIS) {
            return this.thenable(this.createDbKeywordCompletion(this.createRangeAfter(terminalNode)));
        }
        return this.thenable();
    }

    public visitArgument(ctx: mongoParser.ArgumentContext): Promise<CompletionItem[]> {
        return ctx.parent!.accept(this);
    }

    public visitObjectLiteral(ctx: mongoParser.ObjectLiteralContext): Thenable<CompletionItem[]> {
        const functionName = this.getFunctionName(ctx);
        const collectionName = this.getCollectionName(ctx);
        if (collectionName && functionName) {
            if (
                [
                    'find',
                    'findOne',
                    'findOneAndDelete',
                    'findOneAndUpdate',
                    'findOneAndReplace',
                    'deleteOne',
                    'deleteMany',
                    'remove',
                ].indexOf(functionName) !== -1
            ) {
                return this.getArgumentCompletionItems(
                    this.schemaService.queryDocumentUri(collectionName),
                    collectionName,
                    ctx,
                );
            }
        }
        return ctx.parent!.accept(this);
    }

    public visitArrayLiteral(ctx: mongoParser.ArrayLiteralContext): Thenable<CompletionItem[]> {
        const functionName = this.getFunctionName(ctx);
        const collectionName = this.getCollectionName(ctx);
        if (collectionName && functionName) {
            if (['aggregate'].indexOf(functionName) !== -1) {
                return this.getArgumentCompletionItems(
                    this.schemaService.aggregateDocumentUri(collectionName),
                    collectionName,
                    ctx,
                );
            }
        }
        return ctx.parent!.accept(this);
    }

    public visitElementList(ctx: mongoParser.ElementListContext): Promise<CompletionItem[]> {
        return ctx.parent!.accept(this);
    }

    public visitPropertyNameAndValueList(ctx: mongoParser.PropertyNameAndValueListContext): Promise<CompletionItem[]> {
        return ctx.parent!.accept(this);
    }

    public visitPropertyAssignment(ctx: mongoParser.PropertyAssignmentContext): Promise<CompletionItem[]> {
        return ctx.parent!.accept(this);
    }

    public visitPropertyValue(ctx: mongoParser.PropertyValueContext): Promise<CompletionItem[]> {
        return ctx.parent!.accept(this);
    }

    public visitPropertyName(ctx: mongoParser.PropertyNameContext): Promise<CompletionItem[]> {
        return ctx.parent!.accept(this);
    }

    public visitLiteral(ctx: mongoParser.LiteralContext): Promise<CompletionItem[]> {
        return ctx.parent!.accept(this);
    }

    public visitTerminal(ctx: TerminalNode): Promise<CompletionItem[]> {
        return ctx.parent!.accept(this);
    }

    public visitErrorNode(ctx: ErrorNode): Promise<CompletionItem[]> {
        return ctx.parent!.accept(this);
    }

    private getArgumentCompletionItems(
        documentUri: string,
        _collectionName: string,
        ctx: ParserRuleContext,
    ): Thenable<CompletionItem[]> {
        const text = this.textDocument.getText();
        const document = TextDocument.create(
            documentUri,
            'json',
            1,
            text.substring(ctx.start.startIndex, ctx.stop!.stopIndex + 1),
        );
        const positionOffset = this.textDocument.offsetAt(this.at);
        const contextOffset = ctx.start.startIndex;
        const position = document.positionAt(positionOffset - contextOffset);
        return this.jsonLanguageService
            .doComplete(document, position, this.jsonLanguageService.parseJSONDocument(document))
            .then((list) => {
                return list!.items.map((item: CompletionItem) => {
                    const startPositionOffset = document.offsetAt(item.textEdit!.range.start);
                    const endPositionOffset = document.offsetAt(item.textEdit!.range.end);
                    item.textEdit!.range = Range.create(
                        this.textDocument.positionAt(startPositionOffset + contextOffset),
                        this.textDocument.positionAt(contextOffset + endPositionOffset),
                    );
                    return item;
                });
            });
    }

    private getFunctionName(ctx: ParseTree): string {
        let parent = ctx.parent!;
        if (!(parent && parent instanceof mongoParser.ArgumentContext)) {
            return null!;
        }
        parent = parent.parent!;
        if (!(parent && parent instanceof mongoParser.ArgumentsContext)) {
            return null!;
        }
        parent = parent.parent!;
        if (!(parent && parent instanceof mongoParser.FunctionCallContext)) {
            return null!;
        }
        return (<mongoParser.FunctionCallContext>parent)._FUNCTION_NAME.text!;
    }

    private getCollectionName(ctx: ParseTree): string {
        let parent = ctx.parent!;
        if (!(parent && parent instanceof mongoParser.ArgumentContext)) {
            return null!;
        }
        parent = parent.parent!;
        if (!(parent && parent instanceof mongoParser.ArgumentsContext)) {
            return null!;
        }
        parent = parent.parent!;
        if (!(parent && parent instanceof mongoParser.FunctionCallContext)) {
            return null!;
        }
        let previousNode = this.getPreviousNode(parent);
        if (previousNode && previousNode instanceof TerminalNode && previousNode.symbol.type === mongoLexer.DOT) {
            previousNode = this.getPreviousNode(previousNode);
            if (previousNode && previousNode instanceof mongoParser.CollectionContext) {
                return previousNode.text;
            }
        }
        return null!;
    }

    private getCompletionItemsFromTerminalNode(node: TerminalNode): Promise<CompletionItem[]> {
        if (node._symbol.type === mongoParser.mongoParser.DB) {
            return this.thenable(this.createDbKeywordCompletion(this.createRange(node)));
        }
        if (node._symbol.type === mongoParser.mongoParser.SEMICOLON) {
            return this.thenable(this.createDbKeywordCompletion(this.createRangeAfter(node)));
        }
        if (node._symbol.type === mongoParser.mongoParser.DOT) {
            const previousNode = this.getPreviousNode(node);
            if (previousNode && previousNode instanceof TerminalNode) {
                if (previousNode._symbol.type === mongoParser.mongoParser.DB) {
                    return Promise.all([
                        this.createCollectionCompletions(this.createRangeAfter(node)),
                        this.createDbFunctionCompletions(this.createRangeAfter(node)),
                    ]).then(([collectionCompletions, dbFunctionCompletions]) => [
                        ...collectionCompletions,
                        ...dbFunctionCompletions,
                    ]);
                }
            }
            if (previousNode instanceof mongoParser.CollectionContext) {
                return this.createCollectionFunctionsCompletions(this.createRangeAfter(node));
            }
        }
        if (node instanceof ErrorNode) {
            const previousNode = this.getPreviousNode(node);
            if (previousNode) {
                if (previousNode instanceof TerminalNode) {
                    return this.getCompletionItemsFromTerminalNode(previousNode);
                }
                return previousNode.accept(this);
            }
        }
        return this.thenable();
    }

    private getLastTerminalNode(ctx: ParserRuleContext): TerminalNode {
        return ctx.children ? <TerminalNode>ctx.children
                  .slice()
                  .reverse()
                  .filter(
                      (node) =>
                          node instanceof TerminalNode &&
                          node.symbol.stopIndex > -1 &&
                          node.symbol.stopIndex < this.offset,
                  )[0] : null!;
    }

    private getPreviousNode(node: ParseTree): ParseTree {
        let previousNode: ParseTree = null!;
        const parentNode = node.parent!;
        for (let i = 0; i < parentNode.childCount; i++) {
            const currentNode = parentNode.getChild(i);
            if (currentNode === node) {
                break;
            }
            previousNode = currentNode;
        }
        return previousNode;
    }

    private createDbKeywordCompletion(range: Range): CompletionItem {
        return {
            textEdit: {
                newText: 'db',
                range,
            },
            kind: CompletionItemKind.Keyword,
            label: 'db',
        };
    }

    private createDbFunctionCompletions(range: Range): Promise<CompletionItem[]> {
        return this.thenable(
            this.createFunctionCompletion('adminCommand', range),
            this.createFunctionCompletion('auth', range),
            this.createFunctionCompletion('cloneDatabase', range),
            this.createFunctionCompletion('commandHelp', range),
            this.createFunctionCompletion('copyDatabase', range),
            this.createFunctionCompletion('createCollection', range),
            this.createFunctionCompletion('createView', range),
            this.createFunctionCompletion('createUser', range),
            this.createFunctionCompletion('currentOp', range),
            this.createFunctionCompletion('dropDatabase', range),
            this.createFunctionCompletion('eval', range),
            this.createFunctionCompletion('fsyncLock', range),
            this.createFunctionCompletion('fsyncUnLock', range),
            this.createFunctionCompletion('getCollection', range),
            this.createFunctionCompletion('getCollectionInfos', range),
            this.createFunctionCompletion('getCollectionNames', range),
            this.createFunctionCompletion('getLastError', range),
            this.createFunctionCompletion('getLastErrorObj', range),
            this.createFunctionCompletion('getLogComponents', range),
            this.createFunctionCompletion('getMongo', range),
            this.createFunctionCompletion('getName', range),
            this.createFunctionCompletion('getPrevError', range),
            this.createFunctionCompletion('getProfilingLevel', range),
            this.createFunctionCompletion('getProfilingStatus', range),
            this.createFunctionCompletion('getReplicationInfo', range),
            this.createFunctionCompletion('getSiblingDB', range),
            this.createFunctionCompletion('getWriteConcern', range),
            this.createFunctionCompletion('hostInfo', range),
            this.createFunctionCompletion('isMaster', range),
            this.createFunctionCompletion('killOp', range),
            this.createFunctionCompletion('listCommands', range),
            this.createFunctionCompletion('loadServerScripts', range),
            this.createFunctionCompletion('logout', range),
            this.createFunctionCompletion('printCollectionStats', range),
            this.createFunctionCompletion('printReplicationInfo', range),
            this.createFunctionCompletion('printShardingStatus', range),
            this.createFunctionCompletion('printSlaveReplicationInfo', range),
            this.createFunctionCompletion('dropUser', range),
            this.createFunctionCompletion('repairDatabase', range),
            this.createFunctionCompletion('runCommand', range),
            this.createFunctionCompletion('serverStatus', range),
            this.createFunctionCompletion('setLogLevel', range),
            this.createFunctionCompletion('setProfilingLevel', range),
            this.createFunctionCompletion('setWriteConcern', range),
            this.createFunctionCompletion('unsetWriteConcern', range),
            this.createFunctionCompletion('setVerboseShell', range),
            this.createFunctionCompletion('shotdownServer', range),
            this.createFunctionCompletion('stats', range),
            this.createFunctionCompletion('version', range),
        );
    }

    private createCollectionCompletions(range: Range): Promise<CompletionItem[]> {
        if (this.db) {
            return <Promise<CompletionItem[]>>this.db.collections().then((collections) => {
                return collections.map(
                    (collection) =>
                        <CompletionItem>{
                            textEdit: {
                                newText: collection.collectionName,
                                range,
                            },
                            label: collection.collectionName,
                            kind: CompletionItemKind.Property,
                            filterText: collection.collectionName,
                            sortText: `1:${collection.collectionName}`,
                        },
                );
            });
        }
        return Promise.resolve([]);
    }

    private createCollectionFunctionsCompletions(range: Range): Promise<CompletionItem[]> {
        return this.thenable(
            this.createFunctionCompletion('bulkWrite', range),
            this.createFunctionCompletion('count', range),
            this.createFunctionCompletion('copyTo', range),
            this.createFunctionCompletion('convertToCapped', range),
            this.createFunctionCompletion('createIndex', range),
            this.createFunctionCompletion('createIndexes', range),
            this.createFunctionCompletion('dataSize', range),
            this.createFunctionCompletion('deleteOne', range),
            this.createFunctionCompletion('deleteMany', range),
            this.createFunctionCompletion('distinct', range),
            this.createFunctionCompletion('drop', range),
            this.createFunctionCompletion('dropIndex', range),
            this.createFunctionCompletion('dropIndexes', range),
            this.createFunctionCompletion('ensureIndex', range),
            this.createFunctionCompletion('explain', range),
            this.createFunctionCompletion('reIndex', range),
            this.createFunctionCompletion('find', range),
            this.createFunctionCompletion('findOne', range),
            this.createFunctionCompletion('findOneAndDelete', range),
            this.createFunctionCompletion('findOneAndReplace', range),
            this.createFunctionCompletion('findOneAndUpdate', range),
            this.createFunctionCompletion('getDB', range),
            this.createFunctionCompletion('getPlanCache', range),
            this.createFunctionCompletion('getIndexes', range),
            this.createFunctionCompletion('group', range),
            this.createFunctionCompletion('insert', range),
            this.createFunctionCompletion('insertOne', range),
            this.createFunctionCompletion('insertMany', range),
            this.createFunctionCompletion('mapReduce', range),
            this.createFunctionCompletion('aggregate', range),
            this.createFunctionCompletion('remove', range),
            this.createFunctionCompletion('replaceOne', range),
            this.createFunctionCompletion('renameCollection', range),
            this.createFunctionCompletion('runCommand', range),
            this.createFunctionCompletion('save', range),
            this.createFunctionCompletion('stats', range),
            this.createFunctionCompletion('storageSize', range),
            this.createFunctionCompletion('totalIndexSize', range),
            this.createFunctionCompletion('update', range),
            this.createFunctionCompletion('updateOne', range),
            this.createFunctionCompletion('updateMany', range),
            this.createFunctionCompletion('validate', range),
            this.createFunctionCompletion('getShardVersion', range),
            this.createFunctionCompletion('getShardDistribution', range),
            this.createFunctionCompletion('getSplitKeysForChunks', range),
            this.createFunctionCompletion('getWriteConcern', range),
            this.createFunctionCompletion('setWriteConcern', range),
            this.createFunctionCompletion('unsetWriteConcern', range),
            this.createFunctionCompletion('latencyStats', range),
        );
    }

    private createFunctionCompletion(label: string, range: Range): CompletionItem {
        return {
            textEdit: {
                newText: label,
                range,
            },
            kind: CompletionItemKind.Function,
            label,
            sortText: `2:${label}`,
        };
    }

    private createRange(parserRuleContext: ParseTree): Range {
        if (parserRuleContext instanceof ParserRuleContext) {
            const startToken = parserRuleContext.start;
            let stopToken = parserRuleContext.stop;
            if (!stopToken || startToken.type === mongoParser.mongoParser.EOF) {
                stopToken = startToken;
            }

            const stop = stopToken.stopIndex;
            return this._createRange(startToken.startIndex, stop);
        }

        if (parserRuleContext instanceof TerminalNode) {
            return this._createRange(parserRuleContext.symbol.startIndex, parserRuleContext.symbol.stopIndex);
        }

        return null!;
    }

    private createRangeAfter(parserRuleContext: ParseTree): Range {
        if (parserRuleContext instanceof ParserRuleContext) {
            let stopToken = parserRuleContext.stop;
            if (!stopToken) {
                stopToken = parserRuleContext.start;
            }

            const stop = stopToken.stopIndex;
            return this._createRange(stop + 1, stop + 1);
        }

        if (parserRuleContext instanceof TerminalNode) {
            return this._createRange(parserRuleContext.symbol.stopIndex + 1, parserRuleContext.symbol.stopIndex + 1);
        }

        //currently returning an null for the sake of linting. Would prefer to throw an error, but don't want
        // to introduce a regression bug.
        return null!;
    }

    private _createRange(start: number, end: number): Range {
        const endPosition = this.textDocument.positionAt(end);
        if (endPosition.line < this.at.line) {
            return Range.create(Position.create(this.at.line, 0), this.at);
        }
        const startPosition = this.textDocument.positionAt(start);
        return Range.create(startPosition, endPosition);
    }

    private thenable(...completionItems: CompletionItem[]): Promise<CompletionItem[]> {
        return Promise.resolve(completionItems || []);
    }
}
