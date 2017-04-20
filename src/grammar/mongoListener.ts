// Generated from ./grammar/mongo.g4 by ANTLR 4.6-SNAPSHOT


import { ParseTreeListener } from 'antlr4ts/tree/ParseTreeListener';

import { MongoCommandsContext } from './mongoParser';
import { CommandsContext } from './mongoParser';
import { CommandContext } from './mongoParser';
import { FunctionCallContext } from './mongoParser';


/**
 * This interface defines a complete listener for a parse tree produced by
 * `mongoParser`.
 */
export interface mongoListener extends ParseTreeListener {
	/**
	 * Enter a parse tree produced by `mongoParser.mongoCommands`.
	 * @param ctx the parse tree
	 */
	enterMongoCommands?: (ctx: MongoCommandsContext) => void;
	/**
	 * Exit a parse tree produced by `mongoParser.mongoCommands`.
	 * @param ctx the parse tree
	 */
	exitMongoCommands?: (ctx: MongoCommandsContext) => void;

	/**
	 * Enter a parse tree produced by `mongoParser.commands`.
	 * @param ctx the parse tree
	 */
	enterCommands?: (ctx: CommandsContext) => void;
	/**
	 * Exit a parse tree produced by `mongoParser.commands`.
	 * @param ctx the parse tree
	 */
	exitCommands?: (ctx: CommandsContext) => void;

	/**
	 * Enter a parse tree produced by `mongoParser.command`.
	 * @param ctx the parse tree
	 */
	enterCommand?: (ctx: CommandContext) => void;
	/**
	 * Exit a parse tree produced by `mongoParser.command`.
	 * @param ctx the parse tree
	 */
	exitCommand?: (ctx: CommandContext) => void;

	/**
	 * Enter a parse tree produced by `mongoParser.functionCall`.
	 * @param ctx the parse tree
	 */
	enterFunctionCall?: (ctx: FunctionCallContext) => void;
	/**
	 * Exit a parse tree produced by `mongoParser.functionCall`.
	 * @param ctx the parse tree
	 */
	exitFunctionCall?: (ctx: FunctionCallContext) => void;
}

