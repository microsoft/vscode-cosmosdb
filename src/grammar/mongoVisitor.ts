// Generated from ./grammar/mongo.g4 by ANTLR 4.6-SNAPSHOT


import { ParseTreeVisitor } from 'antlr4ts/tree/ParseTreeVisitor';

import { MongoCommandsContext } from './mongoParser';
import { CommandsContext } from './mongoParser';
import { CommandContext } from './mongoParser';
import { FunctionCallContext } from './mongoParser';


/**
 * This interface defines a complete generic visitor for a parse tree produced
 * by `mongoParser`.
 *
 * @param <Result> The return type of the visit operation. Use `void` for
 * operations with no return type.
 */
export interface mongoVisitor<Result> extends ParseTreeVisitor<Result> {
	/**
	 * Visit a parse tree produced by `mongoParser.mongoCommands`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitMongoCommands?: (ctx: MongoCommandsContext) => Result;

	/**
	 * Visit a parse tree produced by `mongoParser.commands`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitCommands?: (ctx: CommandsContext) => Result;

	/**
	 * Visit a parse tree produced by `mongoParser.command`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitCommand?: (ctx: CommandContext) => Result;

	/**
	 * Visit a parse tree produced by `mongoParser.functionCall`.
	 * @param ctx the parse tree
	 * @return the visitor result
	 */
	visitFunctionCall?: (ctx: FunctionCallContext) => Result;
}

