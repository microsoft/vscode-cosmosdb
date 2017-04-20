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
import { TextDocument, CompletionItem, Position, Range, CompletionItemKind } from 'vscode-languageserver';

export class CompletionItemsVisitor extends MongoVisitor<Promise<CompletionItem[]>> {

	constructor(private textDocument: TextDocument, private db: Db) {
		super();
	}

	visitCommand(ctx: mongoParser.CommandContext): Promise<CompletionItem[]> {
		if (ctx.childCount === 0) {
			return this.thenable(this.createDbKeywordCompletion(ctx));
		}

		const lastTerminalNode = this.getLastTerminalNode(ctx);
		if (lastTerminalNode) {
			return this.getCompletionItemsFromTerminalNode(lastTerminalNode);
		}
		return this.thenable();
	}

	visitFunctionCall(ctx: mongoParser.FunctionCallContext): Promise<CompletionItem[]> {
		const previousNode = this.getPreviousNode(ctx);
		if (previousNode instanceof TerminalNode) {
			return this.getCompletionItemsFromTerminalNode(previousNode);
		}
		return this.thenable();
	}

	visitTerminal(ctx: TerminalNode): Promise<CompletionItem[]> {
		return ctx.parent.accept(this);
	}

	visitErrorNode(ctx: ErrorNode): Promise<CompletionItem[]> {
		return ctx.parent.accept(this);
	}

	private getCompletionItemsFromTerminalNode(node: TerminalNode): Promise<CompletionItem[]> {
		if (node._symbol.type === mongoParser.mongoParser.DB) {
			return this.thenable(this.createDbKeywordCompletion(node.parent));
		}
		if (node._symbol.type === mongoParser.mongoParser.DOT) {
			const previousNode = this.getPreviousNode(node);
			if (previousNode && previousNode instanceof TerminalNode) {
				if (previousNode._symbol.type === mongoParser.mongoParser.DB) {
					return Promise.all([this.createCollectionCompletions(node), this.createDbFunctionCompletions(node)])
						.then(([collectionCompletions, dbFunctionCompletions]) => [...collectionCompletions, ...dbFunctionCompletions]);
				}
				if (previousNode._symbol.type === mongoParser.mongoParser.STRING_LITERAL) {
					return this.createCollectionFunctionsCompletions(node);
				}
			}
		}
		if (node instanceof ErrorNode) {
			const previousNode = this.getPreviousNode(node);
			if (previousNode) {
				if (previousNode instanceof TerminalNode) {
					return this.getCompletionItemsFromTerminalNode(previousNode);
				}
			}
		}
		return this.thenable();
	}

	private getLastTerminalNode(ctx: ParserRuleContext): TerminalNode {
		return <TerminalNode>ctx.children.slice().reverse().filter(node => node instanceof TerminalNode)[0];
	}

	private getPreviousNode(node: ParseTree): ParseTree {
		let previousNode = null;
		const parentNode = node.parent;
		for (let i = 0; i < parentNode.childCount; i++) {
			const currentNode = parentNode.getChild(i);
			if (currentNode === node) {
				break;
			}
			previousNode = currentNode;
		}
		return previousNode;
	}

	private createDbKeywordCompletion(rangeContext: ParseTree): CompletionItem {
		return {
			textEdit: {
				newText: 'db.',
				range: this.createRange(rangeContext)
			},
			kind: CompletionItemKind.Keyword,
			label: 'db'
		};
	}

	private createDbFunctionCompletions(rangeContext: ParseTree): Promise<CompletionItem[]> {
		return this.thenable(
			this.createFunctionCompletion('adminCommand', rangeContext),
			this.createFunctionCompletion('auth', rangeContext),
			this.createFunctionCompletion('cloneDatabase', rangeContext),
			this.createFunctionCompletion('commandHelp', rangeContext),
			this.createFunctionCompletion('copyDatabase', rangeContext),
			this.createFunctionCompletion('createCollection', rangeContext),
			this.createFunctionCompletion('createView', rangeContext),
			this.createFunctionCompletion('createUser', rangeContext),
			this.createFunctionCompletion('currentOp', rangeContext),
			this.createFunctionCompletion('dropDatabase', rangeContext),
			this.createFunctionCompletion('eval', rangeContext),
			this.createFunctionCompletion('fsyncLock', rangeContext),
			this.createFunctionCompletion('fsyncUnLock', rangeContext),
			this.createFunctionCompletion('getCollection', rangeContext),
			this.createFunctionCompletion('getCollectionInfos', rangeContext),
			this.createFunctionCompletion('getCollectionNames', rangeContext),
			this.createFunctionCompletion('getLastError', rangeContext),
			this.createFunctionCompletion('getLastErrorObj', rangeContext),
			this.createFunctionCompletion('getLogComponents', rangeContext),
			this.createFunctionCompletion('getMongo', rangeContext),
			this.createFunctionCompletion('getName', rangeContext),
			this.createFunctionCompletion('getPrevError', rangeContext),
			this.createFunctionCompletion('getProfilingLevel', rangeContext),
			this.createFunctionCompletion('getProfilingStatus', rangeContext),
			this.createFunctionCompletion('getReplicationInfo', rangeContext),
			this.createFunctionCompletion('getSiblingDB', rangeContext),
			this.createFunctionCompletion('getWriteConcern', rangeContext),
			this.createFunctionCompletion('hostInfo', rangeContext),
			this.createFunctionCompletion('isMaster', rangeContext),
			this.createFunctionCompletion('killOp', rangeContext),
			this.createFunctionCompletion('listCommands', rangeContext),
			this.createFunctionCompletion('loadServerScripts', rangeContext),
			this.createFunctionCompletion('logout', rangeContext),
			this.createFunctionCompletion('printCollectionStats', rangeContext),
			this.createFunctionCompletion('printReplicationInfo', rangeContext),
			this.createFunctionCompletion('printShardingStatus', rangeContext),
			this.createFunctionCompletion('printSlaveReplicationInfo', rangeContext),
			this.createFunctionCompletion('dropUser', rangeContext),
			this.createFunctionCompletion('repairDatabase', rangeContext),
			this.createFunctionCompletion('runCommand', rangeContext),
			this.createFunctionCompletion('serverStatus', rangeContext),
			this.createFunctionCompletion('setLogLevel', rangeContext),
			this.createFunctionCompletion('setProfilingLevel', rangeContext),
			this.createFunctionCompletion('setWriteConcern', rangeContext),
			this.createFunctionCompletion('unsetWriteConcern', rangeContext),
			this.createFunctionCompletion('setVerboseShell', rangeContext),
			this.createFunctionCompletion('shotdownServer', rangeContext),
			this.createFunctionCompletion('stats', rangeContext),
			this.createFunctionCompletion('version', rangeContext),
		);
	}

	private createCollectionCompletions(rangeContext: ParseTree): Promise<CompletionItem[]> {
		return <Promise<CompletionItem[]>>this.db.collections().then(collections => {
			return collections.map(collection => (<CompletionItem>{
				textEdit: {
					newText: collection.collectionName + '.',
					range: this.createRange(rangeContext)
				},
				label: collection.collectionName,
				kind: CompletionItemKind.Property,
				filterText: 'collection'
			}));
		})
	}

	private createCollectionFunctionsCompletions(rangeContext: ParseTree): Promise<CompletionItem[]> {
		return this.thenable(
			this.createFunctionCompletion('bulkWrite', rangeContext),
			this.createFunctionCompletion('count', rangeContext),
			this.createFunctionCompletion('copyTo', rangeContext),
			this.createFunctionCompletion('converToCapped', rangeContext),
			this.createFunctionCompletion('createIndex', rangeContext),
			this.createFunctionCompletion('createIndexes', rangeContext),
			this.createFunctionCompletion('dataSize', rangeContext),
			this.createFunctionCompletion('deleteOne', rangeContext),
			this.createFunctionCompletion('deleteMany', rangeContext),
			this.createFunctionCompletion('distinct', rangeContext),
			this.createFunctionCompletion('drop', rangeContext),
			this.createFunctionCompletion('dropIndex', rangeContext),
			this.createFunctionCompletion('dropIndexes', rangeContext),
			this.createFunctionCompletion('ensureIndex', rangeContext),
			this.createFunctionCompletion('explain', rangeContext),
			this.createFunctionCompletion('reIndex', rangeContext),
			this.createFunctionCompletion('find', rangeContext),
			this.createFunctionCompletion('findOne', rangeContext),
			this.createFunctionCompletion('findOneAndDelete', rangeContext),
			this.createFunctionCompletion('findOneAndReplace', rangeContext),
			this.createFunctionCompletion('findOneAndUpdate', rangeContext),
			this.createFunctionCompletion('getDB', rangeContext),
			this.createFunctionCompletion('getPlanCache', rangeContext),
			this.createFunctionCompletion('getIndexes', rangeContext),
			this.createFunctionCompletion('group', rangeContext),
			this.createFunctionCompletion('insert', rangeContext),
			this.createFunctionCompletion('insertOne', rangeContext),
			this.createFunctionCompletion('insertMany', rangeContext),
			this.createFunctionCompletion('mapReduce', rangeContext),
			this.createFunctionCompletion('aggregate', rangeContext),
			this.createFunctionCompletion('remove', rangeContext),
			this.createFunctionCompletion('replaceOne', rangeContext),
			this.createFunctionCompletion('renameCollection', rangeContext),
			this.createFunctionCompletion('runCommand', rangeContext),
			this.createFunctionCompletion('save', rangeContext),
			this.createFunctionCompletion('stats', rangeContext),
			this.createFunctionCompletion('storageSize', rangeContext),
			this.createFunctionCompletion('totalIndexSize', rangeContext),
			this.createFunctionCompletion('update', rangeContext),
			this.createFunctionCompletion('updateOne', rangeContext),
			this.createFunctionCompletion('updateMany', rangeContext),
			this.createFunctionCompletion('validate', rangeContext),
			this.createFunctionCompletion('getShardVersion', rangeContext),
			this.createFunctionCompletion('getShardDistribution', rangeContext),
			this.createFunctionCompletion('getSplitKeysForChunks', rangeContext),
			this.createFunctionCompletion('getWriteConcern', rangeContext),
			this.createFunctionCompletion('setWriteConcern', rangeContext),
			this.createFunctionCompletion('unsetWriteConcern', rangeContext),
			this.createFunctionCompletion('latencyStats', rangeContext),
		);
	}

	private createFunctionCompletion(label: string, rangeContext: ParseTree): CompletionItem {
		return {
			textEdit: {
				newText: label,
				range: this.createRange(rangeContext)
			},
			kind: CompletionItemKind.Function,
			label
		};
	}

	private createRange(parserRuleContext: ParseTree): Range {
		if (parserRuleContext instanceof ParserRuleContext) {
			var startToken = parserRuleContext.start;
			var stopToken = parserRuleContext.stop;
			if (stopToken === null || startToken.type === mongoParser.mongoParser.EOF) {
				stopToken = startToken;
			}

			var stop = stopToken.stopIndex;
			return this._createSelection(startToken.startIndex, stop);
		}

		if (parserRuleContext instanceof TerminalNode) {
			var startToken = parserRuleContext._symbol;
			return this._createSelection(startToken.stopIndex + 1, startToken.stopIndex + 1);
		}
	}

	private _createSelection(start: number, end: number): Range {
		const startPosition = this.textDocument.positionAt(start);
		const endPosition = this.textDocument.positionAt(end);
		return Range.create(startPosition, endPosition);
	}

	private thenable(...completionItems: CompletionItem[]): Promise<CompletionItem[]> {
		return Promise.resolve(completionItems || []);
	}

}