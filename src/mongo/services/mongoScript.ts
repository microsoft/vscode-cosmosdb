import { ANTLRInputStream as InputStream } from 'antlr4ts/ANTLRInputStream';
import { CommonTokenStream } from 'antlr4ts/CommonTokenStream';
import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';
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

	private readonly _mongoScripts: MongoScript[];

	constructor(private textDocument: TextDocument, private db: Db) {
		const lexer = new mongoLexer(new InputStream(textDocument.getText()));
		const parser = new mongoParser.mongoParser(new CommonTokenStream(lexer));

		// Make parser and lexer silent
		lexer.removeErrorListeners();
		parser.removeErrorListeners();

		this._mongoScripts = new MongoScriptDocumentVisitor().visit(parser.commands());
	}

	provideCompletionItemsAt(position: Position): Promise<CompletionItem[]> {
		const lastScript = this._mongoScripts[this._mongoScripts.length - 1];
		return new CompletionItemsVisitor(this.textDocument, this.db).visit(lastScript.lastNode);
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

