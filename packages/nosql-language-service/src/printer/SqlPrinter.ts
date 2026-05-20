/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * @module printer/SqlPrinter
 *
 * Serializes an AST back into a CosmosDB NoSQL SQL string.
 * This is the inverse of {@link parse} — enabling round-trip
 * transformations: parse → modify AST → print.
 *
 * The output is canonical (deterministic formatting) but not
 * pretty-printed with indentation. All clauses are space-separated
 * on a single line.
 */

import * as AST from '../ast/nodes.js';

const BINARY_OP_MAP: Record<AST.SqlBinaryScalarOperatorKind, string> = {
    Add: '+',
    Subtract: '-',
    Multiply: '*',
    Divide: '/',
    Modulo: '%',
    Equal: '=',
    NotEqual: '!=',
    LessThan: '<',
    GreaterThan: '>',
    LessThanOrEqual: '<=',
    GreaterThanOrEqual: '>=',
    And: 'AND',
    Or: 'OR',
    BitwiseAnd: '&',
    BitwiseOr: '|',
    BitwiseXor: '^',
    LeftShift: '<<',
    RightShift: '>>',
    ZeroFillRightShift: '>>>',
    StringConcat: '||',
};

const UNARY_OP_MAP: Record<AST.SqlUnaryScalarOperatorKind, string> = {
    Plus: '+',
    Minus: '-',
    BitwiseNot: '~',
    Not: 'NOT',
};

/**
 * Serialize a {@link SqlProgram} AST back into a SQL query string.
 *
 * @param program - The root AST node (output of {@link parse}).
 * @returns A canonical SQL string that, when reparsed, produces
 *          a structurally identical AST.
 *
 * @example
 * ```typescript
 * const { ast } = parse("SELECT  *  FROM  c");
 * sqlToString(ast!); // "SELECT * FROM c"
 * ```
 */
export function sqlToString(program: AST.SqlProgram): string {
    return printQuery(program.query);
}

function printQuery(q: AST.SqlQuery): string {
    const parts: string[] = [];
    parts.push(printSelectClause(q.select));
    if (q.from) parts.push(printFromClause(q.from));
    if (q.where) parts.push(`WHERE ${printExpr(q.where.expression)}`);
    if (q.groupBy) parts.push(`GROUP BY ${q.groupBy.expressions.map(printExpr).join(', ')}`);
    if (q.orderBy) {
        const items = q.orderBy.items.map(printOrderByItem).join(', ');
        parts.push(q.orderBy.isRank ? `ORDER BY RANK ${items}` : `ORDER BY ${items}`);
    }
    if (q.offsetLimit) {
        parts.push(`OFFSET ${printExpr(q.offsetLimit.offset.value)} LIMIT ${printExpr(q.offsetLimit.limit.value)}`);
    }
    return parts.join(' ');
}

function printSelectClause(s: AST.SqlSelectClause): string {
    const parts = ['SELECT'];
    if (s.distinct) parts.push('DISTINCT');
    if (s.top) parts.push(`TOP ${printExpr(s.top.value)}`);
    parts.push(printSelectSpec(s.spec));
    return parts.join(' ');
}

function printSelectSpec(spec: AST.SqlSelectSpec): string {
    switch (spec.kind) {
        case 'SelectStarSpec':
            return '*';
        case 'SelectValueSpec':
            return `VALUE ${printExpr(spec.expression)}`;
        case 'SelectListSpec':
            return spec.items.map(printSelectItem).join(', ');
    }
}

function printSelectItem(item: AST.SqlSelectItem): string {
    let result = printExpr(item.expression);
    if (item.alias) {
        result += item.alias.isString ? ` AS "${item.alias.value}"` : ` AS ${item.alias.value}`;
    }
    return result;
}

function printFromClause(f: AST.SqlFromClause): string {
    return `FROM ${printCollectionExpr(f.collection)}`;
}

function printCollectionExpr(c: AST.SqlCollectionExpression): string {
    switch (c.kind) {
        case 'AliasedCollectionExpression': {
            let s = printCollection(c.collection);
            if (c.alias) s += ` AS ${c.alias.value}`;
            return s;
        }
        case 'ArrayIteratorCollectionExpression':
            return `${c.identifier.value} IN ${printCollection(c.collection)}`;
        case 'JoinCollectionExpression':
            return `${printCollectionExpr(c.left)} JOIN ${printCollectionExpr(c.right)}`;
    }
}

function printCollection(c: AST.SqlCollection): string {
    switch (c.kind) {
        case 'InputPathCollection': {
            let s = c.identifier.value;
            if (c.path) s += printPath(c.path);
            return s;
        }
        case 'SubqueryCollection':
            return `(${printQuery(c.query)})`;
    }
}

function printPath(p: AST.SqlPathExpression): string {
    let result = '';
    if (p.parentPath) result += printPath(p.parentPath);
    switch (p.kind) {
        case 'IdentifierPathExpression':
            result += `.${p.identifier.value}`;
            break;
        case 'NumberPathExpression':
            result += `[${p.value.value}]`;
            break;
        case 'StringPathExpression':
            result += `["${p.value.value}"]`;
            break;
    }
    return result;
}

function printOrderByItem(item: AST.SqlOrderByItem): string {
    let s = printExpr(item.expression);
    if (item.sortOrder === AST.SqlSortOrder.Ascending) s += ' ASC';
    if (item.sortOrder === AST.SqlSortOrder.Descending) s += ' DESC';
    return s;
}

function printExpr(expr: AST.SqlScalarExpression): string {
    switch (expr.kind) {
        case 'LiteralScalarExpression':
            return printLiteral(expr.literal);
        case 'PropertyRefScalarExpression':
            if (expr.member) return `${printExpr(expr.member)}.${expr.identifier.value}`;
            return expr.identifier.value;
        case 'ParameterRefScalarExpression':
            return expr.parameter.name;
        case 'BinaryScalarExpression':
            return `${printExpr(expr.left)} ${BINARY_OP_MAP[expr.operator]} ${printExpr(expr.right)}`;
        case 'UnaryScalarExpression': {
            const op = UNARY_OP_MAP[expr.operator];
            return op === 'NOT' ? `NOT ${printExpr(expr.operand)}` : `${op}${printExpr(expr.operand)}`;
        }
        case 'ConditionalScalarExpression':
            return `${printExpr(expr.condition)} ? ${printExpr(expr.consequent)} : ${printExpr(expr.alternate)}`;
        case 'CoalesceScalarExpression':
            return `${printExpr(expr.left)} ?? ${printExpr(expr.right)}`;
        case 'BetweenScalarExpression': {
            const not = expr.not ? ' NOT' : '';
            return `${printExpr(expr.expression)}${not} BETWEEN ${printExpr(expr.low)} AND ${printExpr(expr.high)}`;
        }
        case 'InScalarExpression': {
            const not = expr.not ? ' NOT' : '';
            return `${printExpr(expr.expression)}${not} IN (${expr.items.map(printExpr).join(', ')})`;
        }
        case 'LikeScalarExpression': {
            const not = expr.not ? ' NOT' : '';
            let s = `${printExpr(expr.expression)}${not} LIKE ${printExpr(expr.pattern)}`;
            if (expr.escape) s += ` ESCAPE "${expr.escape.value}"`;
            return s;
        }
        case 'LetScalarExpression':
            return `(LET ${expr.identifier.value} = ${printExpr(expr.value)} IN ${printExpr(expr.body)})`;
        case 'FunctionCallScalarExpression': {
            const prefix = expr.udf ? 'udf.' : '';
            return `${prefix}${expr.name.value}(${expr.args.map(printExpr).join(', ')})`;
        }
        case 'ExistsScalarExpression':
            return `EXISTS(${printQuery(expr.subquery)})`;
        case 'ArrayScalarExpression':
            return `ARRAY(${printQuery(expr.subquery)})`;
        case 'FirstScalarExpression':
            return `FIRST(${printQuery(expr.subquery)})`;
        case 'LastScalarExpression':
            return `LAST(${printQuery(expr.subquery)})`;
        case 'SubqueryScalarExpression':
            return `(${printQuery(expr.query)})`;
        case 'MemberIndexerScalarExpression':
            return `${printExpr(expr.member)}[${printExpr(expr.indexer)}]`;
        case 'ArrayCreateScalarExpression':
            return `[${expr.items.map(printExpr).join(', ')}]`;
        case 'ObjectCreateScalarExpression': {
            const props = expr.properties.map((p) => `"${p.name.value}": ${printExpr(p.value)}`);
            return `{${props.join(', ')}}`;
        }
    }
}

function printLiteral(lit: AST.SqlLiteral): string {
    switch (lit.kind) {
        case 'StringLiteral':
            return `"${lit.value}"`;
        case 'NumberLiteral':
            return String(lit.value);
        case 'BooleanLiteral':
            return lit.value ? 'true' : 'false';
        case 'NullLiteral':
            return 'null';
        case 'UndefinedLiteral':
            return 'undefined';
    }
}
