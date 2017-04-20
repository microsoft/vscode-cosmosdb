import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';
import { Interval } from 'antlr4ts/misc/Interval';
import { Token } from 'antlr4ts/Token';
import { Db } from 'mongodb';
import * as mongoParser from './../../grammar/mongoParser';
import { mongoLexer } from './../../grammar/mongoLexer';
import { MongoVisitor } from './../../grammar/visitors';
import { CompletionItemsVisitor } from './completionItemProvider';
import { TextDocument, CompletionItem, Position, Range, CompletionItemKind } from 'vscode-languageserver';

export interface MongoScript {
	lastNode: ParseTree;
}

export class MongoScriptDocumentManager {

	getDocument(textDocument: TextDocument, db: Db): MongoScriptDocument {
		return new MongoScriptDocument(textDocument, db);
	}

}

export class MongoScriptDocument {

	private readonly _lexer: mongoLexer;

	constructor(private textDocument: TextDocument, private db: Db) {
		this._lexer = new mongoLexer(new InputStream(textDocument.getText()));
		this._lexer.removeErrorListeners();
	}

	provideCompletionItemsAt(position: Position): Promise<CompletionItem[]> {
		const parser = new mongoParser.mongoParser(new CommonTokenStream(this._lexer));
		parser.removeErrorListeners();

		const offset = this.textDocument.offsetAt(position);
		const lastNode = new NodeFinder(offset).visit(parser.commands());
		if (lastNode) {
			return new CompletionItemsVisitor(this.textDocument, this.db, offset).visit(lastNode);
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
				return ctx
			}
			return null;
		}
		if (ctx instanceof TerminalNode) {
			if (ctx.symbol.stopIndex < this.offset) {
				return ctx
			}
			return null;
		}
		return null;
	}

	protected aggregateResult(aggregate: ParseTree, nextResult: ParseTree): ParseTree {
		if (aggregate && nextResult) {
			const aggregateStart = aggregate instanceof ParserRuleContext ? aggregate.start.startIndex : (<TerminalNode>aggregate).symbol.startIndex;
			const aggregateStop = aggregate instanceof ParserRuleContext ? aggregate.start.stopIndex : (<TerminalNode>aggregate).symbol.stopIndex;
			const nextResultStart = nextResult instanceof ParserRuleContext ? nextResult.start.startIndex : (<TerminalNode>nextResult).symbol.startIndex;
			const nextResultStop = nextResult instanceof ParserRuleContext ? nextResult.start.stopIndex : (<TerminalNode>nextResult).symbol.stopIndex;

			if (Interval.of(aggregateStart, aggregateStop).properlyContains(Interval.of(nextResultStart, nextResultStop))) {
				return aggregate;
			}
			return nextResult;
		}
		return nextResult ? nextResult : aggregate;
	}
}

export class MongoScriptDocumentVisitor extends MongoVisitor<MongoScript[]> {

	private mongoScripts: MongoScript[] = [];

	visitCommand(ctx: mongoParser.CommandContext): MongoScript[] {
		this.mongoScripts.push({
			lastNode: ctx
		});
		return super.visitCommand(ctx);
	}

	visitFunctionCall(ctx: mongoParser.FunctionCallContext): MongoScript[] {
		this.mongoScripts[this.mongoScripts.length - 1].lastNode = ctx;
		return super.visitFunctionCall(ctx);
	}

	visitTerminal(ctx: TerminalNode): MongoScript[] {
		this.mongoScripts[this.mongoScripts.length - 1].lastNode = ctx;
		return super.visitTerminal(ctx);
	}

	visitErrorNode(ctx: ErrorNode): MongoScript[] {
		this.mongoScripts[this.mongoScripts.length - 1].lastNode = ctx;
		return super.visitErrorNode(ctx);
	}

	protected defaultResult(): MongoScript[] {
		return this.mongoScripts;
	}

	protected aggregateResult(aggregate: MongoScript[], nextResult: MongoScript[]): MongoScript[] {
		return nextResult
	}
}

