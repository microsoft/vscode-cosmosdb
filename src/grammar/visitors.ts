import { ParseTreeVisitor } from 'antlr4ts/tree/ParseTreeVisitor';
import { ParseTree } from 'antlr4ts/tree/ParseTree';
import { TerminalNode } from 'antlr4ts/tree/TerminalNode';
import { ErrorNode } from 'antlr4ts/tree/ErrorNode';
import { ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { CommandsContext, CommandContext, FunctionCallContext, MongoCommandsContext } from './mongoParser';
import { mongoVisitor } from './mongoVisitor';

export class MongoVisitor<T> implements mongoVisitor<T> {

	visitMongoCommands(ctx: MongoCommandsContext): T {
		return this.visitChildren(ctx);
	}

	visitCommands(ctx: CommandsContext): T {
		return this.visitChildren(ctx);
	}

	visitCommand(ctx: CommandContext): T {
		return this.visitChildren(ctx);
	}

	visitFunctionCall(ctx: FunctionCallContext): T {
		return this.visitChildren(ctx);
	}

	visit(tree: ParseTree): T {
		return tree.accept(this);
	}

	visitChildren(ctx: ParserRuleContext): T {
		var result = this.defaultResult();
		var n = ctx.childCount
		for (var i = 0; i < n; i++) {
			if (!this.shouldVisitNextChild(ctx, result)) {
				break;
			}

			var childNode = ctx.getChild(i);
			var childResult = childNode.accept(this);
			result = this.aggregateResult(result, childResult);
		}
		return result;
	}

	visitTerminal(node: TerminalNode): T {
		return this.defaultResult();
	}

	visitErrorNode(node: ErrorNode): T {
		return this.defaultResult();
	}

	protected defaultResult(): T {
		return null;
	}

	protected aggregateResult(aggregate: T, nextResult: T): T {
		return nextResult === null ? aggregate : nextResult;
	}

	shouldVisitNextChild(node, currentResult: T): boolean {
		return true;
	}
}