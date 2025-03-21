/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import { Interval } from 'antlr4ts/misc/Interval';
import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { type ParseTree } from 'antlr4ts/tree/ParseTree';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { type Db } from 'mongodb';
import { type LanguageService as JsonLanguageService } from 'vscode-json-languageservice';
import { type CompletionItem, type Position } from 'vscode-languageserver';
import { type TextDocument } from 'vscode-languageserver-textdocument';
import { mongoLexer } from '../../grammar/mongoLexer';
import * as mongoParser from '../../grammar/mongoParser';
import { MongoVisitor } from '../../grammar/visitors';
import { CompletionItemsVisitor } from './completionItemProvider';
import { type SchemaService } from './schemaService';

export class MongoScriptDocumentManager {
    constructor(
        private schemaService: SchemaService,
        private jsonLanguageService: JsonLanguageService,
    ) {}

    public getDocument(textDocument: TextDocument, db: Db): MongoScriptDocument {
        return new MongoScriptDocument(textDocument, db, this.schemaService, this.jsonLanguageService);
    }
}

export class MongoScriptDocument {
    private readonly _lexer: mongoLexer;

    constructor(
        private textDocument: TextDocument,
        private db: Db,
        private schemaService: SchemaService,
        private jsonLanguageService: JsonLanguageService,
    ) {
        this._lexer = new mongoLexer(new InputStream(textDocument.getText()));
        this._lexer.removeErrorListeners();
    }

    public provideCompletionItemsAt(position: Position): Promise<CompletionItem[]> {
        const parser = new mongoParser.mongoParser(new CommonTokenStream(this._lexer));
        parser.removeErrorListeners();

        const offset = this.textDocument.offsetAt(position);
        const lastNode = new NodeFinder(offset).visit(parser.commands());
        if (lastNode) {
            return new CompletionItemsVisitor(
                this.textDocument,
                this.db,
                offset,
                this.schemaService,
                this.jsonLanguageService,
            ).visit(lastNode);
        }
        return Promise.resolve([]);
    }
}

class NodeFinder extends MongoVisitor<ParseTree> {
    constructor(private offset: number) {
        super();
    }

    protected defaultResult(ctx: ParseTree): ParseTree {
        if (ctx instanceof ParserRuleContext) {
            const stop = ctx.stop ? ctx.stop.stopIndex : ctx.start.stopIndex;
            if (stop < this.offset) {
                return ctx;
            }
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return null!;
        }
        if (ctx instanceof TerminalNode) {
            if (ctx.symbol.stopIndex < this.offset) {
                return ctx;
            }
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            return null!;
        }
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        return null!;
    }

    protected aggregateResult(aggregate: ParseTree, nextResult: ParseTree): ParseTree {
        if (aggregate && nextResult) {
            const aggregateStart =
                aggregate instanceof ParserRuleContext
                    ? aggregate.start.startIndex
                    : (<TerminalNode>aggregate).symbol.startIndex;
            const aggregateStop =
                aggregate instanceof ParserRuleContext
                    ? aggregate.start.stopIndex
                    : (<TerminalNode>aggregate).symbol.stopIndex;
            const nextResultStart =
                nextResult instanceof ParserRuleContext
                    ? nextResult.start.startIndex
                    : (<TerminalNode>nextResult).symbol.startIndex;
            const nextResultStop =
                nextResult instanceof ParserRuleContext
                    ? nextResult.start.stopIndex
                    : (<TerminalNode>nextResult).symbol.stopIndex;

            if (
                Interval.of(aggregateStart, aggregateStop).properlyContains(
                    Interval.of(nextResultStart, nextResultStop),
                )
            ) {
                return aggregate;
            }
            return nextResult;
        }
        return nextResult ? nextResult : aggregate;
    }
}
