/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// CosmosDB NoSQL SQL — Abstract Syntax Tree node types
// Mirrors C++ SQL*.h classes from queryLanguages/sql/
// All nodes are immutable plain objects with a discriminant `kind` field.
// ---------------------------------------------------------------------------

import { type SourceRange } from '../errors/SqlError.js';

// ========================== Enums ==========================================

export enum SqlBinaryScalarOperatorKind {
    Add = 'Add',
    Subtract = 'Subtract',
    Multiply = 'Multiply',
    Divide = 'Divide',
    Modulo = 'Modulo',
    Equal = 'Equal',
    NotEqual = 'NotEqual',
    LessThan = 'LessThan',
    GreaterThan = 'GreaterThan',
    LessThanOrEqual = 'LessThanOrEqual',
    GreaterThanOrEqual = 'GreaterThanOrEqual',
    And = 'And',
    Or = 'Or',
    BitwiseAnd = 'BitwiseAnd',
    BitwiseOr = 'BitwiseOr',
    BitwiseXor = 'BitwiseXor',
    LeftShift = 'LeftShift',
    RightShift = 'RightShift',
    ZeroFillRightShift = 'ZeroFillRightShift',
    StringConcat = 'StringConcat',
}

export enum SqlUnaryScalarOperatorKind {
    Plus = 'Plus',
    Minus = 'Minus',
    BitwiseNot = 'BitwiseNot',
    Not = 'Not',
}

export enum SqlSortOrder {
    None = 'None',
    Ascending = 'Ascending',
    Descending = 'Descending',
}

// ========================== Node kind discriminant =========================

export type SqlNodeKind =
    | 'Program'
    | 'Query'
    | 'SelectClause'
    | 'SelectListSpec'
    | 'SelectValueSpec'
    | 'SelectStarSpec'
    | 'SelectItem'
    | 'TopSpec'
    | 'FromClause'
    | 'WhereClause'
    | 'GroupByClause'
    | 'OrderByClause'
    | 'OrderByItem'
    | 'OffsetLimitClause'
    | 'OffsetSpec'
    | 'LimitSpec'
    // Collection expressions
    | 'AliasedCollectionExpression'
    | 'ArrayIteratorCollectionExpression'
    | 'JoinCollectionExpression'
    | 'InputPathCollection'
    | 'SubqueryCollection'
    // Path expressions
    | 'IdentifierPathExpression'
    | 'NumberPathExpression'
    | 'StringPathExpression'
    // Scalar expressions
    | 'LiteralScalarExpression'
    | 'PropertyRefScalarExpression'
    | 'ParameterRefScalarExpression'
    | 'BinaryScalarExpression'
    | 'UnaryScalarExpression'
    | 'ConditionalScalarExpression'
    | 'CoalesceScalarExpression'
    | 'BetweenScalarExpression'
    | 'InScalarExpression'
    | 'LikeScalarExpression'
    | 'LetScalarExpression'
    | 'FunctionCallScalarExpression'
    | 'ExistsScalarExpression'
    | 'ArrayScalarExpression'
    | 'FirstScalarExpression'
    | 'LastScalarExpression'
    | 'SubqueryScalarExpression'
    | 'MemberIndexerScalarExpression'
    | 'ArrayCreateScalarExpression'
    | 'ObjectCreateScalarExpression'
    // Leaves
    | 'Identifier'
    | 'Parameter'
    | 'PropertyName'
    | 'ObjectProperty'
    | 'SelectItemAlias'
    // Literals
    | 'StringLiteral'
    | 'NumberLiteral'
    | 'BooleanLiteral'
    | 'NullLiteral'
    | 'UndefinedLiteral';

// ========================== Base =============================================

export interface SqlNodeBase {
    kind: SqlNodeKind;
    range?: SourceRange;
}

// ========================== Top-level ========================================

export interface SqlProgram extends SqlNodeBase {
    kind: 'Program';
    query: SqlQuery;
}

export interface SqlQuery extends SqlNodeBase {
    kind: 'Query';
    select: SqlSelectClause;
    from?: SqlFromClause;
    where?: SqlWhereClause;
    groupBy?: SqlGroupByClause;
    orderBy?: SqlOrderByClause;
    offsetLimit?: SqlOffsetLimitClause;
}

// ========================== SELECT ===========================================

export interface SqlSelectClause extends SqlNodeBase {
    kind: 'SelectClause';
    distinct: boolean;
    top?: SqlTopSpec;
    spec: SqlSelectSpec;
}

export type SqlSelectSpec = SqlSelectListSpec | SqlSelectValueSpec | SqlSelectStarSpec;

export interface SqlSelectListSpec extends SqlNodeBase {
    kind: 'SelectListSpec';
    items: SqlSelectItem[];
}

export interface SqlSelectValueSpec extends SqlNodeBase {
    kind: 'SelectValueSpec';
    expression: SqlScalarExpression;
}

export interface SqlSelectStarSpec extends SqlNodeBase {
    kind: 'SelectStarSpec';
}

export interface SqlSelectItem extends SqlNodeBase {
    kind: 'SelectItem';
    expression: SqlScalarExpression;
    alias?: SqlSelectItemAlias;
}

export interface SqlSelectItemAlias extends SqlNodeBase {
    kind: 'SelectItemAlias';
    value: string;
    isString: boolean; // true if alias was a quoted string, false if identifier
}

export interface SqlTopSpec extends SqlNodeBase {
    kind: 'TopSpec';
    value: SqlScalarExpression;
}

// ========================== FROM =============================================

export interface SqlFromClause extends SqlNodeBase {
    kind: 'FromClause';
    collection: SqlCollectionExpression;
}

export type SqlCollectionExpression =
    | SqlAliasedCollectionExpression
    | SqlArrayIteratorCollectionExpression
    | SqlJoinCollectionExpression;

export interface SqlAliasedCollectionExpression extends SqlNodeBase {
    kind: 'AliasedCollectionExpression';
    collection: SqlCollection;
    alias?: SqlIdentifier;
}

export interface SqlArrayIteratorCollectionExpression extends SqlNodeBase {
    kind: 'ArrayIteratorCollectionExpression';
    identifier: SqlIdentifier;
    collection: SqlCollection;
}

export interface SqlJoinCollectionExpression extends SqlNodeBase {
    kind: 'JoinCollectionExpression';
    left: SqlCollectionExpression;
    right: SqlCollectionExpression;
}

export type SqlCollection = SqlInputPathCollection | SqlSubqueryCollection;

export interface SqlInputPathCollection extends SqlNodeBase {
    kind: 'InputPathCollection';
    identifier: SqlIdentifier;
    path?: SqlPathExpression;
}

export interface SqlSubqueryCollection extends SqlNodeBase {
    kind: 'SubqueryCollection';
    query: SqlQuery;
}

// ========================== Path expressions ==================================

export type SqlPathExpression = SqlIdentifierPathExpression | SqlNumberPathExpression | SqlStringPathExpression;

export interface SqlIdentifierPathExpression extends SqlNodeBase {
    kind: 'IdentifierPathExpression';
    parentPath?: SqlPathExpression;
    identifier: SqlIdentifier;
}

export interface SqlNumberPathExpression extends SqlNodeBase {
    kind: 'NumberPathExpression';
    parentPath?: SqlPathExpression;
    value: SqlNumberLiteral;
}

export interface SqlStringPathExpression extends SqlNodeBase {
    kind: 'StringPathExpression';
    parentPath?: SqlPathExpression;
    value: SqlStringLiteral;
}

// ========================== WHERE / GROUP BY / ORDER BY / OFFSET-LIMIT =======

export interface SqlWhereClause extends SqlNodeBase {
    kind: 'WhereClause';
    expression: SqlScalarExpression;
}

export interface SqlGroupByClause extends SqlNodeBase {
    kind: 'GroupByClause';
    expressions: SqlScalarExpression[];
}

export interface SqlOrderByClause extends SqlNodeBase {
    kind: 'OrderByClause';
    items: SqlOrderByItem[];
    isRank: boolean;
}

export interface SqlOrderByItem extends SqlNodeBase {
    kind: 'OrderByItem';
    expression: SqlScalarExpression;
    sortOrder: SqlSortOrder;
}

export interface SqlOffsetLimitClause extends SqlNodeBase {
    kind: 'OffsetLimitClause';
    offset: SqlOffsetSpec;
    limit: SqlLimitSpec;
}

export interface SqlOffsetSpec extends SqlNodeBase {
    kind: 'OffsetSpec';
    value: SqlScalarExpression;
}

export interface SqlLimitSpec extends SqlNodeBase {
    kind: 'LimitSpec';
    value: SqlScalarExpression;
}

// ========================== Scalar expressions ================================

export type SqlScalarExpression =
    | SqlLiteralScalarExpression
    | SqlPropertyRefScalarExpression
    | SqlParameterRefScalarExpression
    | SqlBinaryScalarExpression
    | SqlUnaryScalarExpression
    | SqlConditionalScalarExpression
    | SqlCoalesceScalarExpression
    | SqlBetweenScalarExpression
    | SqlInScalarExpression
    | SqlLikeScalarExpression
    | SqlLetScalarExpression
    | SqlFunctionCallScalarExpression
    | SqlExistsScalarExpression
    | SqlArrayScalarExpression
    | SqlFirstScalarExpression
    | SqlLastScalarExpression
    | SqlSubqueryScalarExpression
    | SqlMemberIndexerScalarExpression
    | SqlArrayCreateScalarExpression
    | SqlObjectCreateScalarExpression;

export interface SqlLiteralScalarExpression extends SqlNodeBase {
    kind: 'LiteralScalarExpression';
    literal: SqlLiteral;
}

export interface SqlPropertyRefScalarExpression extends SqlNodeBase {
    kind: 'PropertyRefScalarExpression';
    member?: SqlScalarExpression; // parent expression (for a.b.c chains)
    identifier: SqlIdentifier;
}

export interface SqlParameterRefScalarExpression extends SqlNodeBase {
    kind: 'ParameterRefScalarExpression';
    parameter: SqlParameter;
}

export interface SqlBinaryScalarExpression extends SqlNodeBase {
    kind: 'BinaryScalarExpression';
    operator: SqlBinaryScalarOperatorKind;
    left: SqlScalarExpression;
    right: SqlScalarExpression;
}

export interface SqlUnaryScalarExpression extends SqlNodeBase {
    kind: 'UnaryScalarExpression';
    operator: SqlUnaryScalarOperatorKind;
    operand: SqlScalarExpression;
}

export interface SqlConditionalScalarExpression extends SqlNodeBase {
    kind: 'ConditionalScalarExpression';
    condition: SqlScalarExpression;
    consequent: SqlScalarExpression;
    alternate: SqlScalarExpression;
}

export interface SqlCoalesceScalarExpression extends SqlNodeBase {
    kind: 'CoalesceScalarExpression';
    left: SqlScalarExpression;
    right: SqlScalarExpression;
}

export interface SqlBetweenScalarExpression extends SqlNodeBase {
    kind: 'BetweenScalarExpression';
    expression: SqlScalarExpression;
    low: SqlScalarExpression;
    high: SqlScalarExpression;
    not: boolean;
}

export interface SqlInScalarExpression extends SqlNodeBase {
    kind: 'InScalarExpression';
    expression: SqlScalarExpression;
    items: SqlScalarExpression[];
    not: boolean;
}

export interface SqlLikeScalarExpression extends SqlNodeBase {
    kind: 'LikeScalarExpression';
    expression: SqlScalarExpression;
    pattern: SqlScalarExpression;
    escape?: SqlStringLiteral;
    not: boolean;
}

export interface SqlLetScalarExpression extends SqlNodeBase {
    kind: 'LetScalarExpression';
    identifier: SqlIdentifier;
    value: SqlScalarExpression;
    body: SqlScalarExpression;
}

export interface SqlFunctionCallScalarExpression extends SqlNodeBase {
    kind: 'FunctionCallScalarExpression';
    name: SqlIdentifier;
    args: SqlScalarExpression[];
    udf: boolean;
}

export interface SqlExistsScalarExpression extends SqlNodeBase {
    kind: 'ExistsScalarExpression';
    subquery: SqlQuery;
}

export interface SqlArrayScalarExpression extends SqlNodeBase {
    kind: 'ArrayScalarExpression';
    subquery: SqlQuery;
}

export interface SqlFirstScalarExpression extends SqlNodeBase {
    kind: 'FirstScalarExpression';
    subquery: SqlQuery;
}

export interface SqlLastScalarExpression extends SqlNodeBase {
    kind: 'LastScalarExpression';
    subquery: SqlQuery;
}

export interface SqlSubqueryScalarExpression extends SqlNodeBase {
    kind: 'SubqueryScalarExpression';
    query: SqlQuery;
}

export interface SqlMemberIndexerScalarExpression extends SqlNodeBase {
    kind: 'MemberIndexerScalarExpression';
    member: SqlScalarExpression;
    indexer: SqlScalarExpression;
}

export interface SqlArrayCreateScalarExpression extends SqlNodeBase {
    kind: 'ArrayCreateScalarExpression';
    items: SqlScalarExpression[];
}

export interface SqlObjectCreateScalarExpression extends SqlNodeBase {
    kind: 'ObjectCreateScalarExpression';
    properties: SqlObjectProperty[];
}

export interface SqlObjectProperty extends SqlNodeBase {
    kind: 'ObjectProperty';
    name: SqlPropertyName;
    value: SqlScalarExpression;
}

export interface SqlPropertyName extends SqlNodeBase {
    kind: 'PropertyName';
    value: string;
}

// ========================== Leaves ===========================================

export interface SqlIdentifier extends SqlNodeBase {
    kind: 'Identifier';
    value: string;
}

export interface SqlParameter extends SqlNodeBase {
    kind: 'Parameter';
    name: string; // includes the @ prefix
}

// ========================== Literals =========================================

export type SqlLiteral = SqlStringLiteral | SqlNumberLiteral | SqlBooleanLiteral | SqlNullLiteral | SqlUndefinedLiteral;

export interface SqlStringLiteral extends SqlNodeBase {
    kind: 'StringLiteral';
    value: string;
}

export interface SqlNumberLiteral extends SqlNodeBase {
    kind: 'NumberLiteral';
    value: number;
}

export interface SqlBooleanLiteral extends SqlNodeBase {
    kind: 'BooleanLiteral';
    value: boolean;
}

export interface SqlNullLiteral extends SqlNodeBase {
    kind: 'NullLiteral';
}

export interface SqlUndefinedLiteral extends SqlNodeBase {
    kind: 'UndefinedLiteral';
}

// ========================== Union of all nodes ===============================

export type SqlNode =
    | SqlProgram
    | SqlQuery
    | SqlSelectClause
    | SqlSelectListSpec
    | SqlSelectValueSpec
    | SqlSelectStarSpec
    | SqlSelectItem
    | SqlSelectItemAlias
    | SqlTopSpec
    | SqlFromClause
    | SqlAliasedCollectionExpression
    | SqlArrayIteratorCollectionExpression
    | SqlJoinCollectionExpression
    | SqlInputPathCollection
    | SqlSubqueryCollection
    | SqlIdentifierPathExpression
    | SqlNumberPathExpression
    | SqlStringPathExpression
    | SqlWhereClause
    | SqlGroupByClause
    | SqlOrderByClause
    | SqlOrderByItem
    | SqlOffsetLimitClause
    | SqlOffsetSpec
    | SqlLimitSpec
    | SqlScalarExpression
    | SqlObjectProperty
    | SqlPropertyName
    | SqlIdentifier
    | SqlParameter
    | SqlLiteral;
