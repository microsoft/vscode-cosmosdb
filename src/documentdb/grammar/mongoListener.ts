/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Generated from ./grammar/mongo.g4 by ANTLR 4.6-SNAPSHOT

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ParseTreeListener } from 'antlr4ts/tree/ParseTreeListener';
import {
    type ArgumentContext,
    type ArgumentsContext,
    type ArrayLiteralContext,
    type CollectionContext,
    type CommandContext,
    type CommandsContext,
    type CommentContext,
    type ElementListContext,
    type EmptyCommandContext,
    type FunctionCallContext,
    type LiteralContext,
    type MongoCommandsContext,
    type ObjectLiteralContext,
    type PropertyAssignmentContext,
    type PropertyNameAndValueListContext,
    type PropertyNameContext,
    type PropertyValueContext,
} from './mongoParser';

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
     * Enter a parse tree produced by `mongoParser.emptyCommand`.
     * @param ctx the parse tree
     */
    enterEmptyCommand?: (ctx: EmptyCommandContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.emptyCommand`.
     * @param ctx the parse tree
     */
    exitEmptyCommand?: (ctx: EmptyCommandContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.collection`.
     * @param ctx the parse tree
     */
    enterCollection?: (ctx: CollectionContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.collection`.
     * @param ctx the parse tree
     */
    exitCollection?: (ctx: CollectionContext) => void;

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

    /**
     * Enter a parse tree produced by `mongoParser.arguments`.
     * @param ctx the parse tree
     */
    enterArguments?: (ctx: ArgumentsContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.arguments`.
     * @param ctx the parse tree
     */
    exitArguments?: (ctx: ArgumentsContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.argument`.
     * @param ctx the parse tree
     */
    enterArgument?: (ctx: ArgumentContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.argument`.
     * @param ctx the parse tree
     */
    exitArgument?: (ctx: ArgumentContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.objectLiteral`.
     * @param ctx the parse tree
     */
    enterObjectLiteral?: (ctx: ObjectLiteralContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.objectLiteral`.
     * @param ctx the parse tree
     */
    exitObjectLiteral?: (ctx: ObjectLiteralContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.arrayLiteral`.
     * @param ctx the parse tree
     */
    enterArrayLiteral?: (ctx: ArrayLiteralContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.arrayLiteral`.
     * @param ctx the parse tree
     */
    exitArrayLiteral?: (ctx: ArrayLiteralContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.elementList`.
     * @param ctx the parse tree
     */
    enterElementList?: (ctx: ElementListContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.elementList`.
     * @param ctx the parse tree
     */
    exitElementList?: (ctx: ElementListContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.propertyNameAndValueList`.
     * @param ctx the parse tree
     */
    enterPropertyNameAndValueList?: (ctx: PropertyNameAndValueListContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.propertyNameAndValueList`.
     * @param ctx the parse tree
     */
    exitPropertyNameAndValueList?: (ctx: PropertyNameAndValueListContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.propertyAssignment`.
     * @param ctx the parse tree
     */
    enterPropertyAssignment?: (ctx: PropertyAssignmentContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.propertyAssignment`.
     * @param ctx the parse tree
     */
    exitPropertyAssignment?: (ctx: PropertyAssignmentContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.propertyValue`.
     * @param ctx the parse tree
     */
    enterPropertyValue?: (ctx: PropertyValueContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.propertyValue`.
     * @param ctx the parse tree
     */
    exitPropertyValue?: (ctx: PropertyValueContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.literal`.
     * @param ctx the parse tree
     */
    enterLiteral?: (ctx: LiteralContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.literal`.
     * @param ctx the parse tree
     */
    exitLiteral?: (ctx: LiteralContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.propertyName`.
     * @param ctx the parse tree
     */
    enterPropertyName?: (ctx: PropertyNameContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.propertyName`.
     * @param ctx the parse tree
     */
    exitPropertyName?: (ctx: PropertyNameContext) => void;

    /**
     * Enter a parse tree produced by `mongoParser.comment`.
     * @param ctx the parse tree
     */
    enterComment?: (ctx: CommentContext) => void;
    /**
     * Exit a parse tree produced by `mongoParser.comment`.
     * @param ctx the parse tree
     */
    exitComment?: (ctx: CommentContext) => void;
}
