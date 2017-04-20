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

	constructor(private textDocument: TextDocument, private db: Db, private offset: number) {
		super();
	}

	visitCommands(ctx: mongoParser.CommandsContext): Promise<CompletionItem[]> {
		return this.thenable(this.createDbKeywordCompletion(this.createRange(ctx)));
	}

	visitCommand(ctx: mongoParser.CommandContext): Promise<CompletionItem[]> {
		if (ctx.childCount === 0) {
			return this.thenable(this.createDbKeywordCompletion(this.createRange(ctx)));
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
			return this.thenable(this.createDbKeywordCompletion(this.createRange(node)));
		}
		if (node._symbol.type === mongoParser.mongoParser.COMMAND_DELIMITTER) {
			return this.thenable(this.createDbKeywordCompletion(this.createRangeAfterTerminalNode(node)));
		}
		if (node._symbol.type === mongoParser.mongoParser.DOT) {
			const previousNode = this.getPreviousNode(node);
			if (previousNode && previousNode instanceof TerminalNode) {
				if (previousNode._symbol.type === mongoParser.mongoParser.DB) {
					return Promise.all([this.createCollectionCompletions(this.createRangeAfterTerminalNode(node)), this.createDbFunctionCompletions(this.createRangeAfterTerminalNode(node))])
						.then(([collectionCompletions, dbFunctionCompletions]) => [...collectionCompletions, ...dbFunctionCompletions]);
				}
				if (previousNode._symbol.type === mongoParser.mongoParser.STRING_LITERAL) {
					return this.createCollectionFunctionsCompletions(this.createRangeAfterTerminalNode(node));
				}
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
		return <TerminalNode>ctx.children.slice().reverse().filter(node => node instanceof TerminalNode && node.symbol.stopIndex > -1 && node.symbol.stopIndex < this.offset)[0];
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

	private createDbKeywordCompletion(range: Range): CompletionItem {
		return {
			textEdit: {
				newText: 'db',
				range
			},
			kind: CompletionItemKind.Keyword,
			label: 'db'
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
		return <Promise<CompletionItem[]>>this.db.collections().then(collections => {
			return collections.map(collection => (<CompletionItem>{
				textEdit: {
					newText: collection.collectionName,
					range
				},
				label: collection.collectionName,
				kind: CompletionItemKind.Property,
				filterText: 'collection'
			}));
		})
	}

	private createCollectionFunctionsCompletions(range: Range): Promise<CompletionItem[]> {
		return this.thenable(
			this.createFunctionCompletion('bulkWrite', range),
			this.createFunctionCompletion('count', range),
			this.createFunctionCompletion('copyTo', range),
			this.createFunctionCompletion('converToCapped', range),
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
				range
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
			return this._createRange(startToken.startIndex, stop);
		}

		if (parserRuleContext instanceof TerminalNode) {
			return this._createRange(parserRuleContext.symbol.startIndex, parserRuleContext.symbol.stopIndex);
		}

		return null;
	}

	private createRangeAfterTerminalNode(terminalNode: TerminalNode): Range {
		return this._createRange(terminalNode.symbol.stopIndex + 1, terminalNode.symbol.stopIndex + 1)
	}

	private _createRange(start: number, end: number): Range {
		const startPosition = this.textDocument.positionAt(start);
		const endPosition = this.textDocument.positionAt(end);
		return Range.create(startPosition, endPosition);
	}

	private thenable(...completionItems: CompletionItem[]): Promise<CompletionItem[]> {
		return Promise.resolve(completionItems || []);
	}

}