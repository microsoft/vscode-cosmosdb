/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ParserRuleContext } from 'antlr4ts/ParserRuleContext';
import { type ErrorNode } from 'antlr4ts/tree/ErrorNode';
import { type ParseTree } from 'antlr4ts/tree/ParseTree';
import { type TerminalNode } from 'antlr4ts/tree/TerminalNode';
import {
    type ArgumentContext,
    type ArgumentsContext,
    type CollectionContext,
    type CommandContext,
    type CommandsContext,
    type FunctionCallContext,
    type MongoCommandsContext,
} from './mongoParser';
import { type mongoVisitor } from './mongoVisitor';

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

    visitCollection(ctx: CollectionContext): T {
        return this.visitChildren(ctx);
    }

    visitFunctionCall(ctx: FunctionCallContext): T {
        return this.visitChildren(ctx);
    }

    visitArgument(ctx: ArgumentContext): T {
        return this.visitChildren(ctx);
    }

    visitArguments(ctx: ArgumentsContext): T {
        return this.visitChildren(ctx);
    }

    visit(tree: ParseTree): T {
        return tree.accept(this);
    }

    visitChildren(ctx: ParserRuleContext): T {
        let result = this.defaultResult(ctx);
        const n = ctx.childCount;
        for (let i = 0; i < n; i++) {
            if (!this.shouldVisitNextChild(ctx, result)) {
                break;
            }

            const childNode = ctx.getChild(i);
            const childResult = childNode.accept(this);
            result = this.aggregateResult(result, childResult);
        }
        return result;
    }

    visitTerminal(node: TerminalNode): T {
        return this.defaultResult(node);
    }

    visitErrorNode(node: ErrorNode): T {
        return this.defaultResult(node);
    }

    protected defaultResult(_node: ParseTree): T {
        // grandfathered-in. Unclear why this is null instead of type T
        return <T>(<unknown>null);
    }

    protected aggregateResult(aggregate: T, nextResult: T): T {
        return !nextResult ? aggregate : nextResult;
    }

    // eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
    shouldVisitNextChild(_node, _currentResult: T): boolean {
        return true;
    }
}
