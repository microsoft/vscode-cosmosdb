/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @module visitor/SqlVisitor
 *
 * Visitor pattern for traversing the CosmosDB SQL AST.
 * Implement {@link SqlVisitor} to process each node type,
 * or use {@link visitNode} to dispatch dynamically by `kind`.
 *
 * @example
 * ```typescript
 * class FieldCollector implements SqlVisitor<void> {
 *   fields: string[] = [];
 *   visitPropertyRefScalarExpression(n) {
 *     this.fields.push(n.identifier.value);
 *   }
 *   // ... implement other visit methods
 * }
 * ```
 */

import type * as AST from '../ast/nodes.js';

/**
 * Visitor interface with one method per AST node kind.
 * @typeParam T - The return type of each visit method.
 */
export interface SqlVisitor<T> {
    visitProgram(node: AST.SqlProgram): T;
    visitQuery(node: AST.SqlQuery): T;
    visitSelectClause(node: AST.SqlSelectClause): T;
    visitSelectListSpec(node: AST.SqlSelectListSpec): T;
    visitSelectValueSpec(node: AST.SqlSelectValueSpec): T;
    visitSelectStarSpec(node: AST.SqlSelectStarSpec): T;
    visitSelectItem(node: AST.SqlSelectItem): T;
    visitTopSpec(node: AST.SqlTopSpec): T;
    visitFromClause(node: AST.SqlFromClause): T;
    visitWhereClause(node: AST.SqlWhereClause): T;
    visitGroupByClause(node: AST.SqlGroupByClause): T;
    visitOrderByClause(node: AST.SqlOrderByClause): T;
    visitOrderByItem(node: AST.SqlOrderByItem): T;
    visitOffsetLimitClause(node: AST.SqlOffsetLimitClause): T;
    visitAliasedCollectionExpression(node: AST.SqlAliasedCollectionExpression): T;
    visitArrayIteratorCollectionExpression(node: AST.SqlArrayIteratorCollectionExpression): T;
    visitJoinCollectionExpression(node: AST.SqlJoinCollectionExpression): T;
    visitInputPathCollection(node: AST.SqlInputPathCollection): T;
    visitSubqueryCollection(node: AST.SqlSubqueryCollection): T;
    visitLiteralScalarExpression(node: AST.SqlLiteralScalarExpression): T;
    visitPropertyRefScalarExpression(node: AST.SqlPropertyRefScalarExpression): T;
    visitParameterRefScalarExpression(node: AST.SqlParameterRefScalarExpression): T;
    visitBinaryScalarExpression(node: AST.SqlBinaryScalarExpression): T;
    visitUnaryScalarExpression(node: AST.SqlUnaryScalarExpression): T;
    visitConditionalScalarExpression(node: AST.SqlConditionalScalarExpression): T;
    visitCoalesceScalarExpression(node: AST.SqlCoalesceScalarExpression): T;
    visitBetweenScalarExpression(node: AST.SqlBetweenScalarExpression): T;
    visitInScalarExpression(node: AST.SqlInScalarExpression): T;
    visitLikeScalarExpression(node: AST.SqlLikeScalarExpression): T;
    visitLetScalarExpression(node: AST.SqlLetScalarExpression): T;
    visitFunctionCallScalarExpression(node: AST.SqlFunctionCallScalarExpression): T;
    visitExistsScalarExpression(node: AST.SqlExistsScalarExpression): T;
    visitArrayScalarExpression(node: AST.SqlArrayScalarExpression): T;
    visitFirstScalarExpression(node: AST.SqlFirstScalarExpression): T;
    visitLastScalarExpression(node: AST.SqlLastScalarExpression): T;
    visitSubqueryScalarExpression(node: AST.SqlSubqueryScalarExpression): T;
    visitMemberIndexerScalarExpression(node: AST.SqlMemberIndexerScalarExpression): T;
    visitArrayCreateScalarExpression(node: AST.SqlArrayCreateScalarExpression): T;
    visitObjectCreateScalarExpression(node: AST.SqlObjectCreateScalarExpression): T;
    visitIdentifier(node: AST.SqlIdentifier): T;
    visitParameter(node: AST.SqlParameter): T;
}

/**
 * Dispatch a node to the correct visitor method based on its `kind`
 * discriminant. Throws if the node kind is unknown.
 *
 * @param node - Any AST node.
 * @param visitor - A fully-implemented visitor.
 * @returns The value returned by the matching visit method.
 */
export function visitNode<T>(node: AST.SqlNode, visitor: SqlVisitor<T>): T {
    switch (node.kind) {
        case 'Program':
            return visitor.visitProgram(node);
        case 'Query':
            return visitor.visitQuery(node);
        case 'SelectClause':
            return visitor.visitSelectClause(node);
        case 'SelectListSpec':
            return visitor.visitSelectListSpec(node);
        case 'SelectValueSpec':
            return visitor.visitSelectValueSpec(node);
        case 'SelectStarSpec':
            return visitor.visitSelectStarSpec(node);
        case 'SelectItem':
            return visitor.visitSelectItem(node);
        case 'TopSpec':
            return visitor.visitTopSpec(node);
        case 'FromClause':
            return visitor.visitFromClause(node);
        case 'WhereClause':
            return visitor.visitWhereClause(node);
        case 'GroupByClause':
            return visitor.visitGroupByClause(node);
        case 'OrderByClause':
            return visitor.visitOrderByClause(node);
        case 'OrderByItem':
            return visitor.visitOrderByItem(node);
        case 'OffsetLimitClause':
            return visitor.visitOffsetLimitClause(node);
        case 'AliasedCollectionExpression':
            return visitor.visitAliasedCollectionExpression(node);
        case 'ArrayIteratorCollectionExpression':
            return visitor.visitArrayIteratorCollectionExpression(node);
        case 'JoinCollectionExpression':
            return visitor.visitJoinCollectionExpression(node);
        case 'InputPathCollection':
            return visitor.visitInputPathCollection(node);
        case 'SubqueryCollection':
            return visitor.visitSubqueryCollection(node);
        case 'LiteralScalarExpression':
            return visitor.visitLiteralScalarExpression(node);
        case 'PropertyRefScalarExpression':
            return visitor.visitPropertyRefScalarExpression(node);
        case 'ParameterRefScalarExpression':
            return visitor.visitParameterRefScalarExpression(node);
        case 'BinaryScalarExpression':
            return visitor.visitBinaryScalarExpression(node);
        case 'UnaryScalarExpression':
            return visitor.visitUnaryScalarExpression(node);
        case 'ConditionalScalarExpression':
            return visitor.visitConditionalScalarExpression(node);
        case 'CoalesceScalarExpression':
            return visitor.visitCoalesceScalarExpression(node);
        case 'BetweenScalarExpression':
            return visitor.visitBetweenScalarExpression(node);
        case 'InScalarExpression':
            return visitor.visitInScalarExpression(node);
        case 'LikeScalarExpression':
            return visitor.visitLikeScalarExpression(node);
        case 'LetScalarExpression':
            return visitor.visitLetScalarExpression(node);
        case 'FunctionCallScalarExpression':
            return visitor.visitFunctionCallScalarExpression(node);
        case 'ExistsScalarExpression':
            return visitor.visitExistsScalarExpression(node);
        case 'ArrayScalarExpression':
            return visitor.visitArrayScalarExpression(node);
        case 'FirstScalarExpression':
            return visitor.visitFirstScalarExpression(node);
        case 'LastScalarExpression':
            return visitor.visitLastScalarExpression(node);
        case 'SubqueryScalarExpression':
            return visitor.visitSubqueryScalarExpression(node);
        case 'MemberIndexerScalarExpression':
            return visitor.visitMemberIndexerScalarExpression(node);
        case 'ArrayCreateScalarExpression':
            return visitor.visitArrayCreateScalarExpression(node);
        case 'ObjectCreateScalarExpression':
            return visitor.visitObjectCreateScalarExpression(node);
        case 'Identifier':
            return visitor.visitIdentifier(node);
        case 'Parameter':
            return visitor.visitParameter(node);
        default:
            throw new Error(`Unknown node kind: ${(node as { kind: string }).kind}`);
    }
}
