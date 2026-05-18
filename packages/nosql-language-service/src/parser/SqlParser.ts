/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// ---------------------------------------------------------------------------
// Chevrotain EmbeddedActionsParser for CosmosDB NoSQL SQL
// Directly builds immutable AST nodes (no intermediate CST).
// Translates the grammar from sql.y almost 1-to-1.
// ---------------------------------------------------------------------------

import { EmbeddedActionsParser, EOF } from 'chevrotain';
import * as AST from '../ast/nodes.js';
import { SqlErrorMessageProvider } from '../errors/SqlErrorMessageProvider.js';
import * as T from '../lexer/tokens.js';
import { allTokens } from '../lexer/tokens.js';
import { pos, posEnd, range, rangeFromNodes, rangeStartEnd } from './parserHelpers.js';

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

export class SqlParser extends EmbeddedActionsParser {
    private isBetweenExpressionAhead(startLookahead = 1): boolean {
        let depth = 0;

        for (let k = startLookahead; ; k++) {
            const token = this.LA(k);
            const tokenType = token.tokenType;

            if (tokenType === EOF) {
                return false;
            }

            if (tokenType === T.LParen || tokenType === T.LBracket || tokenType === T.LBrace) {
                depth++;
                continue;
            }

            if (tokenType === T.RParen || tokenType === T.RBracket || tokenType === T.RBrace) {
                if (depth === 0) {
                    return false;
                }
                depth--;
                continue;
            }

            if (depth !== 0) {
                continue;
            }

            if (tokenType === T.And || tokenType === T.Or) {
                return false;
            }

            if (
                tokenType === T.Comma ||
                tokenType === T.Question ||
                tokenType === T.Colon ||
                tokenType === T.Coalesce
            ) {
                return false;
            }

            if (tokenType === T.Between) {
                return true;
            }

            if (tokenType === T.Not && this.LA(k + 1).tokenType === T.Between) {
                return true;
            }
        }
    }

    constructor() {
        super(allTokens, {
            recoveryEnabled: true,
            maxLookahead: 3,
            errorMessageProvider: new SqlErrorMessageProvider(),
        });
        this.performSelfAnalysis();
    }

    // ======================== program ========================================

    public program = this.RULE('program', (): AST.SqlProgram => {
        const query = this.SUBRULE(this.sqlQuery);
        return { kind: 'Program', query, range: query.range };
    });

    // ======================== sql_query ======================================

    private sqlQuery = this.RULE('sqlQuery', (): AST.SqlQuery => {
        const select = this.SUBRULE(this.selectClause);
        const from = this.OPTION(() => this.SUBRULE(this.fromClause));
        const where = this.OPTION2(() => this.SUBRULE(this.whereClause));
        const groupBy = this.OPTION3(() => this.SUBRULE(this.groupByClause));
        const orderBy = this.OPTION4(() => this.SUBRULE(this.orderByClause));
        const offsetLimit = this.OPTION5(() => this.SUBRULE(this.offsetLimitClause));
        const last = offsetLimit ?? orderBy ?? groupBy ?? where ?? from ?? select;
        return {
            kind: 'Query',
            select,
            from: from ?? undefined,
            where: where ?? undefined,
            groupBy: groupBy ?? undefined,
            orderBy: orderBy ?? undefined,
            offsetLimit: offsetLimit ?? undefined,
            range: rangeFromNodes(select, last),
        };
    });

    // ======================== SELECT =========================================

    private selectClause = this.RULE('selectClause', (): AST.SqlSelectClause => {
        const selTok = this.CONSUME(T.Select);
        let distinct = false;
        this.OPTION(() => {
            this.CONSUME(T.Distinct);
            distinct = true;
        });
        const top = this.OPTION2(() => this.SUBRULE(this.topSpec));
        const spec = this.SUBRULE(this.selection);
        return {
            kind: 'SelectClause',
            distinct,
            top: top ?? undefined,
            spec,
            range: { start: pos(selTok), end: spec.range?.end ?? posEnd(selTok) },
        };
    });

    private topSpec = this.RULE('topSpec', (): AST.SqlTopSpec => {
        const topTok = this.CONSUME(T.Top);
        const value = this.OR<AST.SqlLiteralScalarExpression | AST.SqlParameterRefScalarExpression>([
            { ALT: () => this.SUBRULE(this.numberLitExpr) },
            { ALT: () => this.SUBRULE(this.parameterRefExpr) },
        ]);
        return {
            kind: 'TopSpec',
            value,
            range: { start: pos(topTok), end: value.range?.end ?? posEnd(topTok) },
        };
    });

    private selection = this.RULE('selection', (): AST.SqlSelectSpec => {
        return this.OR<AST.SqlSelectSpec>([
            { ALT: () => this.SUBRULE(this.selectValueSpec) },
            { ALT: () => this.SUBRULE(this.selectStarSpec) },
            { ALT: () => this.SUBRULE(this.selectListSpec) },
        ]);
    });

    private selectListSpec = this.RULE('selectListSpec', (): AST.SqlSelectListSpec => {
        const items: AST.SqlSelectItem[] = [];
        const first = this.SUBRULE(this.selectItem);
        items.push(first);
        this.MANY(() => {
            this.CONSUME(T.Comma);
            items.push(this.SUBRULE2(this.selectItem));
        });
        return {
            kind: 'SelectListSpec',
            items,
            range: rangeFromNodes(first, items[items.length - 1]),
        };
    });

    private selectValueSpec = this.RULE('selectValueSpec', (): AST.SqlSelectValueSpec => {
        const valTok = this.CONSUME(T.Value);
        const expression = this.SUBRULE(this.scalarExpression);
        return {
            kind: 'SelectValueSpec',
            expression,
            range: { start: pos(valTok), end: expression.range?.end ?? posEnd(valTok) },
        };
    });

    private selectStarSpec = this.RULE('selectStarSpec', (): AST.SqlSelectStarSpec => {
        const star = this.CONSUME(T.Star);
        return { kind: 'SelectStarSpec', range: range(star, star) };
    });

    private selectItem = this.RULE('selectItem', (): AST.SqlSelectItem => {
        const expression = this.SUBRULE(this.scalarExpression);
        const alias = this.OPTION(() => this.SUBRULE(this.selectItemAlias));
        return {
            kind: 'SelectItem',
            expression,
            alias: alias ?? undefined,
            range: rangeFromNodes(expression, alias ?? expression),
        };
    });

    private selectItemAlias = this.RULE('selectItemAlias', (): AST.SqlSelectItemAlias => {
        return this.OR<AST.SqlSelectItemAlias>([
            {
                ALT: () => {
                    this.OPTION(() => this.CONSUME(T.As));
                    const identifier = this.SUBRULE(this.id);
                    return {
                        kind: 'SelectItemAlias' as const,
                        value: identifier.value,
                        isString: false,
                        range: identifier.range,
                    };
                },
            },
            {
                ALT: () => {
                    this.OPTION2(() => this.CONSUME2(T.As));
                    const str = this.CONSUME(T.StringLiteral);
                    const raw = str.image.slice(1, -1); // strip quotes
                    return { kind: 'SelectItemAlias' as const, value: raw, isString: true, range: range(str, str) };
                },
            },
        ]);
    });

    // ======================== FROM ==========================================

    private fromClause = this.RULE('fromClause', (): AST.SqlFromClause => {
        const fromTok = this.CONSUME(T.From);
        const collection = this.SUBRULE(this.collectionExpression);
        return {
            kind: 'FromClause',
            collection,
            range: { start: pos(fromTok), end: collection.range?.end ?? posEnd(fromTok) },
        };
    });

    private collectionExpression = this.RULE('collectionExpression', (): AST.SqlCollectionExpression => {
        let left: AST.SqlCollectionExpression = this.SUBRULE(this.primaryCollectionExpression);
        this.MANY(() => {
            this.CONSUME(T.Join);
            const right = this.SUBRULE2(this.primaryCollectionExpression);
            left = {
                kind: 'JoinCollectionExpression',
                left,
                right,
                range: rangeFromNodes(left, right),
            };
        });
        return left;
    });

    private primaryCollectionExpression = this.RULE('primaryCollectionExpression', (): AST.SqlCollectionExpression => {
        return this.OR<AST.SqlCollectionExpression>([
            {
                // id IN input_collection
                GATE: () => {
                    // Peek: Identifier followed by IN
                    const la1 = this.LA(1);
                    const la2 = this.LA(2);
                    return (
                        (la1.tokenType === T.Identifier || la1.tokenType === T.Let || la1.tokenType === T.Rank) &&
                        la2.tokenType === T.In
                    );
                },
                ALT: () => {
                    const identifier = this.SUBRULE(this.id);
                    this.CONSUME(T.In);
                    const collection = this.SUBRULE(this.inputCollection);
                    return {
                        kind: 'ArrayIteratorCollectionExpression' as const,
                        identifier,
                        collection,
                        range: rangeFromNodes(identifier, collection),
                    };
                },
            },
            {
                ALT: () => {
                    const collection = this.SUBRULE2(this.inputCollection);
                    const alias = this.OPTION(() => this.SUBRULE(this.identifierAlias));
                    return {
                        kind: 'AliasedCollectionExpression' as const,
                        collection,
                        alias: alias ?? undefined,
                        range: rangeFromNodes(collection, alias ?? collection),
                    };
                },
            },
        ]);
    });

    private inputCollection = this.RULE('inputCollection', (): AST.SqlCollection => {
        return this.OR<AST.SqlCollection>([
            {
                ALT: () => {
                    const identifier = this.SUBRULE(this.id);
                    const path = this.SUBRULE(this.relativePath);
                    return {
                        kind: 'InputPathCollection' as const,
                        identifier,
                        path: path ?? undefined,
                        range: rangeFromNodes(identifier, path ?? identifier),
                    };
                },
            },
            {
                ALT: () => {
                    this.CONSUME(T.LParen);
                    const query = this.SUBRULE(this.sqlQuery);
                    const rp = this.CONSUME(T.RParen);
                    return {
                        kind: 'SubqueryCollection' as const,
                        query,
                        range: query.range ? { start: query.range.start, end: posEnd(rp) } : undefined,
                    };
                },
            },
        ]);
    });

    private relativePath = this.RULE('relativePath', (): AST.SqlPathExpression | undefined => {
        let path: AST.SqlPathExpression | undefined = undefined;
        this.MANY(() => {
            this.OR([
                {
                    ALT: () => {
                        this.CONSUME(T.Dot);
                        const identifier = this.SUBRULE(this.id);
                        path = {
                            kind: 'IdentifierPathExpression',
                            parentPath: path,
                            identifier,
                            range: rangeFromNodes(path ?? identifier, identifier),
                        };
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.LBracket);
                        const tok = this.OR2([
                            { ALT: () => this.CONSUME(T.NumberLiteral) },
                            { ALT: () => this.CONSUME(T.StringLiteral) },
                        ]);
                        const rb = this.CONSUME(T.RBracket);
                        if (tok.tokenType === T.StringLiteral) {
                            const strLit: AST.SqlStringLiteral = {
                                kind: 'StringLiteral',
                                value: tok.image.slice(1, -1),
                                range: range(tok, tok),
                            };
                            path = {
                                kind: 'StringPathExpression',
                                parentPath: path,
                                value: strLit,
                                range: rangeFromNodes(path ?? strLit, { kind: 'StringLiteral', range: range(rb, rb) }),
                            };
                        } else {
                            const numLit: AST.SqlNumberLiteral = {
                                kind: 'NumberLiteral',
                                value: Number(tok.image),
                                range: range(tok, tok),
                            };
                            path = {
                                kind: 'NumberPathExpression',
                                parentPath: path,
                                value: numLit,
                                range: rangeFromNodes(path ?? numLit, { kind: 'NumberLiteral', range: range(rb, rb) }),
                            };
                        }
                    },
                },
            ]);
        });
        return path;
    });

    // ======================== WHERE / GROUP BY / ORDER BY / OFFSET-LIMIT ====

    private whereClause = this.RULE('whereClause', (): AST.SqlWhereClause => {
        const tok = this.CONSUME(T.Where);
        const expression = this.SUBRULE(this.scalarExpression);
        return {
            kind: 'WhereClause',
            expression,
            range: { start: pos(tok), end: expression.range?.end ?? posEnd(tok) },
        };
    });

    private groupByClause = this.RULE('groupByClause', (): AST.SqlGroupByClause => {
        const tok = this.CONSUME(T.Group);
        this.CONSUME(T.By);
        const expressions = this.SUBRULE(this.scalarExpressionList);
        const last = expressions?.[expressions.length - 1];
        return {
            kind: 'GroupByClause',
            expressions: expressions ?? [],
            range: { start: pos(tok), end: last?.range?.end ?? posEnd(tok) },
        };
    });

    private orderByClause = this.RULE('orderByClause', (): AST.SqlOrderByClause => {
        const tok = this.CONSUME(T.Order);
        this.CONSUME(T.By);
        // ORDER BY RANK func(...)
        let isRank = false;
        const items: AST.SqlOrderByItem[] = [];
        this.OR([
            {
                // ORDER BY RANK score_expression — RANK is followed by an identifier (function name)
                GATE: () => this.LA(1).tokenType === T.Rank && this.LA(2).tokenType !== T.LParen,
                ALT: () => {
                    this.CONSUME(T.Rank);
                    isRank = true;
                    items.push(this.SUBRULE(this.scoreExpressionOrderByItem));
                },
            },
            {
                ALT: () => {
                    items.push(this.SUBRULE2(this.orderByItem));
                    this.MANY(() => {
                        this.CONSUME(T.Comma);
                        items.push(this.SUBRULE3(this.orderByItem));
                    });
                },
            },
        ]);
        const last = items[items.length - 1];
        return {
            kind: 'OrderByClause',
            items,
            isRank,
            range: { start: pos(tok), end: last.range?.end ?? posEnd(tok) },
        };
    });

    // score_expression_orderby_item: only function_call_scalar_expression (matching C++ sql.y)
    private scoreExpressionOrderByItem = this.RULE('scoreExpressionOrderByItem', (): AST.SqlOrderByItem => {
        // Parse function call: id ( args )
        const name = this.SUBRULE(this.idOrKeywordFuncName);
        this.CONSUME(T.LParen);
        const args = this.SUBRULE(this.optScalarExpressionList);
        const rp = this.CONSUME(T.RParen);
        const expression: AST.SqlFunctionCallScalarExpression = {
            kind: 'FunctionCallScalarExpression',
            name,
            args,
            udf: false,
            range: rangeStartEnd(name, rp),
        };
        let sortOrder = AST.SqlSortOrder.None;
        let lastNode: AST.SqlNodeBase = expression;
        this.OPTION(() => {
            const tok = this.OR([
                {
                    ALT: () => {
                        sortOrder = AST.SqlSortOrder.Ascending;
                        return this.CONSUME(T.Asc);
                    },
                },
                {
                    ALT: () => {
                        sortOrder = AST.SqlSortOrder.Descending;
                        return this.CONSUME(T.Desc);
                    },
                },
            ]);
            lastNode = { kind: 'OrderByItem', range: range(tok, tok) };
        });
        return {
            kind: 'OrderByItem',
            expression,
            sortOrder,
            range: rangeFromNodes(expression, lastNode),
        };
    });

    private orderByItem = this.RULE('orderByItem', (): AST.SqlOrderByItem => {
        const expression = this.SUBRULE(this.scalarExpression);
        let sortOrder = AST.SqlSortOrder.None;
        let lastNode: AST.SqlNodeBase = expression;
        this.OPTION(() => {
            const tok = this.OR([
                {
                    ALT: () => {
                        sortOrder = AST.SqlSortOrder.Ascending;
                        return this.CONSUME(T.Asc);
                    },
                },
                {
                    ALT: () => {
                        sortOrder = AST.SqlSortOrder.Descending;
                        return this.CONSUME(T.Desc);
                    },
                },
            ]);
            lastNode = { kind: 'OrderByItem', range: range(tok, tok) };
        });
        return {
            kind: 'OrderByItem',
            expression,
            sortOrder,
            range: rangeFromNodes(expression, lastNode),
        };
    });

    private offsetLimitClause = this.RULE('offsetLimitClause', (): AST.SqlOffsetLimitClause => {
        const offset = this.SUBRULE(this.offsetSpec);
        const limit = this.SUBRULE(this.limitSpec);
        return {
            kind: 'OffsetLimitClause',
            offset,
            limit,
            range: rangeFromNodes(offset, limit),
        };
    });

    private offsetSpec = this.RULE('offsetSpec', (): AST.SqlOffsetSpec => {
        const tok = this.CONSUME(T.Offset);
        const value = this.OR<AST.SqlLiteralScalarExpression | AST.SqlParameterRefScalarExpression>([
            { ALT: () => this.SUBRULE(this.integerLitExpr) },
            { ALT: () => this.SUBRULE(this.parameterRefExpr) },
        ]);
        return {
            kind: 'OffsetSpec',
            value,
            range: { start: pos(tok), end: value.range?.end ?? posEnd(tok) },
        };
    });

    private limitSpec = this.RULE('limitSpec', (): AST.SqlLimitSpec => {
        const tok = this.CONSUME(T.Limit);
        const value = this.OR<AST.SqlLiteralScalarExpression | AST.SqlParameterRefScalarExpression>([
            { ALT: () => this.SUBRULE(this.integerLitExpr) },
            { ALT: () => this.SUBRULE(this.parameterRefExpr) },
        ]);
        return {
            kind: 'LimitSpec',
            value,
            range: { start: pos(tok), end: value.range?.end ?? posEnd(tok) },
        };
    });

    // ======================== Alias helpers ==================================

    private identifierAlias = this.RULE('identifierAlias', (): AST.SqlIdentifier => {
        this.OPTION(() => this.CONSUME(T.As));
        return this.SUBRULE(this.id);
    });

    // ======================== Scalar expressions =============================

    private scalarExpression = this.RULE('scalarExpression', (): AST.SqlScalarExpression => {
        return this.SUBRULE(this.conditionalExpression);
    });

    // Ternary: expr ? expr : expr
    private conditionalExpression = this.RULE('conditionalExpression', (): AST.SqlScalarExpression => {
        let expr = this.SUBRULE(this.coalesceExpression);
        this.OPTION(() => {
            this.CONSUME(T.Question);
            const consequent = this.SUBRULE2(this.scalarExpression);
            this.CONSUME(T.Colon);
            const alternate = this.SUBRULE3(this.scalarExpression);
            expr = {
                kind: 'ConditionalScalarExpression',
                condition: expr,
                consequent,
                alternate,
                range: rangeFromNodes(expr, alternate),
            };
        });
        return expr;
    });

    // Coalesce: expr ?? expr (right-associative, matching C++ %right _COALESCE)
    private coalesceExpression = this.RULE('coalesceExpression', (): AST.SqlScalarExpression => {
        let left = this.SUBRULE(this.booleanOrBetweenExpression);
        this.OPTION(() => {
            this.CONSUME(T.Coalesce);
            const right = this.SUBRULE(this.coalesceExpression); // recurse for right-associativity
            left = {
                kind: 'CoalesceScalarExpression',
                left,
                right,
                range: rangeFromNodes(left, right),
            };
        });
        return left;
    });

    private booleanOrBetweenExpression = this.RULE('booleanOrBetweenExpression', (): AST.SqlScalarExpression => {
        return this.OR([
            {
                GATE: () => this.isBetweenExpressionAhead(),
                ALT: () => this.SUBRULE(this.betweenExpression),
            },
            {
                ALT: () => this.SUBRULE(this.orExpression),
            },
        ]);
    });

    // OR
    private orExpression = this.RULE('orExpression', (): AST.SqlScalarExpression => {
        let left = this.SUBRULE(this.andExpression);
        this.MANY(() => {
            this.CONSUME(T.Or);
            const right = this.SUBRULE2(this.andExpression);
            left = {
                kind: 'BinaryScalarExpression',
                operator: AST.SqlBinaryScalarOperatorKind.Or,
                left,
                right,
                range: rangeFromNodes(left, right),
            };
        });
        return left;
    });

    // AND
    private andExpression = this.RULE('andExpression', (): AST.SqlScalarExpression => {
        let left = this.SUBRULE(this.inLikeExpression);
        this.MANY(() => {
            this.CONSUME(T.And);
            const right = this.SUBRULE2(this.inLikeExpression);
            left = {
                kind: 'BinaryScalarExpression',
                operator: AST.SqlBinaryScalarOperatorKind.And,
                left,
                right,
                range: rangeFromNodes(left, right),
            };
        });
        return left;
    });

    // BETWEEN / NOT BETWEEN are parsed separately from AND / OR so that bare
    // expressions like `a BETWEEN 1 AND 2 AND b = 3` are rejected unless the
    // BETWEEN expression is parenthesized, matching native C++ sql.y behavior.
    private betweenExpression = this.RULE('betweenExpression', (): AST.SqlScalarExpression => {
        let expr = this.SUBRULE(this.comparisonExpression);

        expr = this.OR<AST.SqlScalarExpression>([
            {
                // BETWEEN binary_expression AND binary_expression
                ALT: () => {
                    this.CONSUME(T.Between);
                    const low = this.SUBRULE2(this.comparisonExpression);
                    this.CONSUME(T.And);
                    const high = this.SUBRULE3(this.comparisonExpression);
                    return {
                        kind: 'BetweenScalarExpression' as const,
                        expression: expr,
                        low,
                        high,
                        not: false,
                        range: rangeFromNodes(expr, high),
                    };
                },
            },
            {
                // NOT BETWEEN
                ALT: () => {
                    this.CONSUME2(T.Not);
                    this.CONSUME2(T.Between);
                    const low = this.SUBRULE4(this.comparisonExpression);
                    this.CONSUME2(T.And);
                    const high = this.SUBRULE5(this.comparisonExpression);
                    return {
                        kind: 'BetweenScalarExpression' as const,
                        expression: expr,
                        low,
                        high,
                        not: true,
                        range: rangeFromNodes(expr, high),
                    };
                },
            },
        ]);

        return expr;
    });

    // IN / LIKE (postfix operators after comparison)
    private inLikeExpression = this.RULE('inLikeExpression', (): AST.SqlScalarExpression => {
        let expr = this.SUBRULE(this.comparisonExpression);

        this.OPTION(() => {
            expr = this.OR<AST.SqlScalarExpression>([
                {
                    // NOT IN / NOT LIKE
                    ALT: () => {
                        this.CONSUME(T.Not);
                        return this.OR2<AST.SqlScalarExpression>([
                            {
                                ALT: () => {
                                    this.CONSUME(T.In);
                                    this.CONSUME(T.LParen);
                                    const items = this.SUBRULE(this.scalarExpressionList);
                                    const rp = this.CONSUME(T.RParen);
                                    return {
                                        kind: 'InScalarExpression' as const,
                                        expression: expr,
                                        items,
                                        not: true,
                                        range: rangeStartEnd(expr, rp),
                                    };
                                },
                            },
                            {
                                ALT: () => {
                                    this.CONSUME(T.Like);
                                    const pattern = this.SUBRULE6(this.comparisonExpression);
                                    const escape = this.OPTION2(() => this.SUBRULE(this.optEscape));
                                    return {
                                        kind: 'LikeScalarExpression' as const,
                                        expression: expr,
                                        pattern,
                                        escape: escape ?? undefined,
                                        not: true,
                                        range: rangeFromNodes(expr, escape ?? pattern),
                                    };
                                },
                            },
                        ]);
                    },
                },
                {
                    // IN (list)
                    ALT: () => {
                        this.CONSUME2(T.In);
                        this.CONSUME2(T.LParen);
                        const items = this.SUBRULE2(this.scalarExpressionList);
                        const rp = this.CONSUME2(T.RParen);
                        return {
                            kind: 'InScalarExpression' as const,
                            expression: expr,
                            items,
                            not: false,
                            range: rangeStartEnd(expr, rp),
                        };
                    },
                },
                {
                    // LIKE pattern [ESCAPE str]
                    ALT: () => {
                        this.CONSUME2(T.Like);
                        const pattern = this.SUBRULE7(this.comparisonExpression);
                        const escape = this.OPTION3(() => this.SUBRULE2(this.optEscape));
                        return {
                            kind: 'LikeScalarExpression' as const,
                            expression: expr,
                            pattern,
                            escape: escape ?? undefined,
                            not: false,
                            range: rangeFromNodes(expr, escape ?? pattern),
                        };
                    },
                },
            ]);
        });

        return expr;
    });

    private optEscape = this.RULE('optEscape', (): AST.SqlStringLiteral => {
        this.CONSUME(T.Escape);
        const tok = this.CONSUME(T.StringLiteral);
        return { kind: 'StringLiteral', value: tok.image.slice(1, -1), range: range(tok, tok) };
    });

    // Comparison: = != < > <= >= << >> >>> (left-associative, chainable like C++)
    private comparisonExpression = this.RULE('comparisonExpression', (): AST.SqlScalarExpression => {
        let left = this.SUBRULE(this.stringConcatExpression);
        this.MANY(() => {
            const op = this.OR([
                {
                    ALT: () => {
                        this.CONSUME(T.Equals);
                        return AST.SqlBinaryScalarOperatorKind.Equal;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.NotEqual);
                        return AST.SqlBinaryScalarOperatorKind.NotEqual;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.LessThan);
                        return AST.SqlBinaryScalarOperatorKind.LessThan;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.GreaterThan);
                        return AST.SqlBinaryScalarOperatorKind.GreaterThan;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.LessThanEqual);
                        return AST.SqlBinaryScalarOperatorKind.LessThanOrEqual;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.GreaterThanEqual);
                        return AST.SqlBinaryScalarOperatorKind.GreaterThanOrEqual;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.LeftShift);
                        return AST.SqlBinaryScalarOperatorKind.LeftShift;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.RightShift);
                        return AST.SqlBinaryScalarOperatorKind.RightShift;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.RightShiftZF);
                        return AST.SqlBinaryScalarOperatorKind.ZeroFillRightShift;
                    },
                },
            ]);
            const right = this.SUBRULE2(this.stringConcatExpression);
            left = {
                kind: 'BinaryScalarExpression',
                operator: op,
                left,
                right,
                range: rangeFromNodes(left, right),
            };
        });
        return left;
    });

    // String concat: ||
    private stringConcatExpression = this.RULE('stringConcatExpression', (): AST.SqlScalarExpression => {
        let left = this.SUBRULE(this.bitwiseAdditiveExpression);
        this.MANY(() => {
            this.CONSUME(T.StringConcat);
            const right = this.SUBRULE2(this.bitwiseAdditiveExpression);
            left = {
                kind: 'BinaryScalarExpression',
                operator: AST.SqlBinaryScalarOperatorKind.StringConcat,
                left,
                right,
                range: rangeFromNodes(left, right),
            };
        });
        return left;
    });

    // C++ sql.y places |, ^, &, +, - at the same precedence level and parses
    // them left-associatively (%left '|' '^' '&' '+' '-').  Keep that behavior
    // here so expressions like `1 | 2 + 3` become `(1 | 2) + 3`.
    private bitwiseAdditiveExpression = this.RULE('bitwiseAdditiveExpression', (): AST.SqlScalarExpression => {
        let left = this.SUBRULE(this.multiplicativeExpression);
        this.MANY(() => {
            const op = this.OR([
                {
                    ALT: () => {
                        this.CONSUME(T.Pipe);
                        return AST.SqlBinaryScalarOperatorKind.BitwiseOr;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.Caret);
                        return AST.SqlBinaryScalarOperatorKind.BitwiseXor;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.Ampersand);
                        return AST.SqlBinaryScalarOperatorKind.BitwiseAnd;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.Plus);
                        return AST.SqlBinaryScalarOperatorKind.Add;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.Minus);
                        return AST.SqlBinaryScalarOperatorKind.Subtract;
                    },
                },
            ]);
            const right = this.SUBRULE2(this.multiplicativeExpression);
            left = {
                kind: 'BinaryScalarExpression',
                operator: op,
                left,
                right,
                range: rangeFromNodes(left, right),
            };
        });
        return left;
    });

    // Multiplicative: * / %
    private multiplicativeExpression = this.RULE('multiplicativeExpression', (): AST.SqlScalarExpression => {
        let left = this.SUBRULE(this.unaryExpression);
        this.MANY(() => {
            const op = this.OR([
                {
                    ALT: () => {
                        this.CONSUME(T.Star);
                        return AST.SqlBinaryScalarOperatorKind.Multiply;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.Slash);
                        return AST.SqlBinaryScalarOperatorKind.Divide;
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.Percent);
                        return AST.SqlBinaryScalarOperatorKind.Modulo;
                    },
                },
            ]);
            const right = this.SUBRULE2(this.unaryExpression);
            left = {
                kind: 'BinaryScalarExpression',
                operator: op,
                left,
                right,
                range: rangeFromNodes(left, right),
            };
        });
        return left;
    });

    // Unary: - + ~ NOT (all at same level, matching C++ sql.y unary_expression)
    private unaryExpression = this.RULE('unaryExpression', (): AST.SqlScalarExpression => {
        return this.OR([
            {
                ALT: () => {
                    const tok = this.CONSUME(T.Minus);
                    const operand = this.SUBRULE(this.unaryExpression);
                    // Optimize: -NumberLiteral → negative number literal
                    if (operand.kind === 'LiteralScalarExpression' && operand.literal.kind === 'NumberLiteral') {
                        return {
                            kind: 'LiteralScalarExpression' as const,
                            literal: {
                                kind: 'NumberLiteral' as const,
                                value: -operand.literal.value,
                                range: { start: pos(tok), end: operand.range?.end ?? posEnd(tok) },
                            },
                            range: { start: pos(tok), end: operand.range?.end ?? posEnd(tok) },
                        };
                    }
                    return {
                        kind: 'UnaryScalarExpression' as const,
                        operator: AST.SqlUnaryScalarOperatorKind.Minus,
                        operand,
                        range: { start: pos(tok), end: operand.range?.end ?? posEnd(tok) },
                    };
                },
            },
            {
                ALT: () => {
                    const tok = this.CONSUME(T.Plus);
                    const operand = this.SUBRULE2(this.unaryExpression);
                    return {
                        kind: 'UnaryScalarExpression' as const,
                        operator: AST.SqlUnaryScalarOperatorKind.Plus,
                        operand,
                        range: { start: pos(tok), end: operand.range?.end ?? posEnd(tok) },
                    };
                },
            },
            {
                ALT: () => {
                    const tok = this.CONSUME(T.Tilde);
                    const operand = this.SUBRULE3(this.unaryExpression);
                    return {
                        kind: 'UnaryScalarExpression' as const,
                        operator: AST.SqlUnaryScalarOperatorKind.BitwiseNot,
                        operand,
                        range: { start: pos(tok), end: operand.range?.end ?? posEnd(tok) },
                    };
                },
            },
            {
                ALT: () => {
                    const tok = this.CONSUME(T.Not);
                    const operand = this.SUBRULE4(this.unaryExpression);
                    return {
                        kind: 'UnaryScalarExpression' as const,
                        operator: AST.SqlUnaryScalarOperatorKind.Not,
                        operand,
                        range: { start: pos(tok), end: operand.range?.end ?? posEnd(tok) },
                    };
                },
            },
            { ALT: () => this.SUBRULE(this.postfixExpression) },
        ]);
    });

    // Postfix: primary_expression . id  |  primary_expression [ expr ]
    private postfixExpression = this.RULE('postfixExpression', (): AST.SqlScalarExpression => {
        let expr = this.SUBRULE(this.primaryExpression);
        this.MANY(() => {
            this.OR([
                {
                    ALT: () => {
                        this.CONSUME(T.Dot);
                        const identifier = this.SUBRULE(this.id);
                        expr = {
                            kind: 'PropertyRefScalarExpression',
                            member: expr,
                            identifier,
                            range: rangeFromNodes(expr, identifier),
                        };
                    },
                },
                {
                    ALT: () => {
                        this.CONSUME(T.LBracket);
                        const indexer = this.SUBRULE(this.scalarExpression);
                        const rb = this.CONSUME(T.RBracket);
                        expr = {
                            kind: 'MemberIndexerScalarExpression',
                            member: expr,
                            indexer,
                            range: rangeStartEnd(expr, rb),
                        };
                    },
                },
            ]);
        });
        return expr;
    });

    // Primary expression: literals, identifiers, parens, function calls, etc.
    private primaryExpression = this.RULE('primaryExpression', (): AST.SqlScalarExpression => {
        return this.OR<AST.SqlScalarExpression>([
            // EXISTS (query)
            {
                ALT: () => {
                    const tok = this.CONSUME(T.Exists);
                    this.CONSUME(T.LParen);
                    const query = this.SUBRULE(this.sqlQuery);
                    const rp = this.CONSUME(T.RParen);
                    return {
                        kind: 'ExistsScalarExpression' as const,
                        subquery: query,
                        range: { start: pos(tok), end: posEnd(rp) },
                    };
                },
            },
            // ARRAY (query)
            {
                ALT: () => {
                    const tok = this.CONSUME(T.Array_);
                    this.CONSUME2(T.LParen);
                    const query = this.SUBRULE2(this.sqlQuery);
                    const rp = this.CONSUME2(T.RParen);
                    return {
                        kind: 'ArrayScalarExpression' as const,
                        subquery: query,
                        range: { start: pos(tok), end: posEnd(rp) },
                    };
                },
            },
            // UDF.func(args)
            {
                ALT: () => {
                    const udfTok = this.CONSUME(T.Udf);
                    this.CONSUME3(T.Dot);
                    const name = this.SUBRULE2(this.id);
                    this.CONSUME4(T.LParen);
                    const args = this.SUBRULE(this.optScalarExpressionList);
                    const rp = this.CONSUME4(T.RParen);
                    return {
                        kind: 'FunctionCallScalarExpression' as const,
                        name,
                        args,
                        udf: true,
                        range: { start: pos(udfTok), end: posEnd(rp) },
                    };
                },
            },
            // func(args) — or aggregate subquery: ALL/FIRST/LAST(query)
            {
                GATE: () => {
                    const la1 = this.LA(1);
                    const la2 = this.LA(2);
                    return (
                        (la1.tokenType === T.Identifier ||
                            la1.tokenType === T.Let ||
                            la1.tokenType === T.Rank ||
                            la1.tokenType === T.Left ||
                            la1.tokenType === T.Right) &&
                        la2.tokenType === T.LParen
                    );
                },
                ALT: () => {
                    const name = this.SUBRULE3(this.idOrKeywordFuncName);
                    this.CONSUME5(T.LParen);
                    // Try: is this an aggregate subquery? (ALL, FIRST, LAST with SELECT inside)
                    // We use OR with backtracking — if internal query fails, treat as normal function.
                    return this.OR2<AST.SqlScalarExpression>([
                        {
                            GATE: () => {
                                const nameUpper = name?.value?.toUpperCase() ?? '';
                                return nameUpper === 'ALL' || nameUpper === 'FIRST' || nameUpper === 'LAST';
                            },
                            ALT: () => {
                                const query = this.SUBRULE3(this.sqlQuery);
                                const rp = this.CONSUME5(T.RParen);
                                const nameUpper = name?.value?.toUpperCase() ?? '';
                                if (nameUpper === 'FIRST') {
                                    return {
                                        kind: 'FirstScalarExpression' as const,
                                        subquery: query,
                                        range: rangeStartEnd(name, rp),
                                    };
                                } else if (nameUpper === 'LAST') {
                                    return {
                                        kind: 'LastScalarExpression' as const,
                                        subquery: query,
                                        range: rangeStartEnd(name, rp),
                                    };
                                } else {
                                    // ALL ? EXISTS equivalent
                                    return {
                                        kind: 'ExistsScalarExpression' as const,
                                        subquery: query,
                                        range: rangeStartEnd(name, rp),
                                    };
                                }
                            },
                        },
                        {
                            ALT: () => {
                                const args = this.SUBRULE2(this.optScalarExpressionList);
                                const rp = this.CONSUME6(T.RParen);
                                return {
                                    kind: 'FunctionCallScalarExpression' as const,
                                    name,
                                    args,
                                    udf: false,
                                    range: rangeStartEnd(name, rp),
                                };
                            },
                        },
                    ]);
                },
            },
            // ( scalar_expression )  or  ( subquery )  or  ( let expression )
            {
                ALT: () => {
                    const lp = this.CONSUME7(T.LParen);
                    const inner = this.OR3([
                        {
                            // LET id = expr IN expr
                            GATE: () => this.LA(1).tokenType === T.Let,
                            ALT: () => this.SUBRULE(this.letExpression),
                        },
                        {
                            // subquery: SELECT ...
                            GATE: () => this.LA(1).tokenType === T.Select,
                            ALT: () => {
                                const query = this.SUBRULE4(this.sqlQuery);
                                return {
                                    kind: 'SubqueryScalarExpression' as const,
                                    query,
                                    range: query.range,
                                } as AST.SqlScalarExpression;
                            },
                        },
                        {
                            ALT: () => this.SUBRULE2(this.scalarExpression),
                        },
                    ]);
                    const rp = this.CONSUME7(T.RParen);
                    // Wrap range around parens
                    if (inner.range) {
                        inner.range = { start: pos(lp), end: posEnd(rp) };
                    }
                    return inner;
                },
            },
            // Parameter: @name
            { ALT: () => this.SUBRULE(this.parameterRefExpr) },
            // Literals
            { ALT: () => this.SUBRULE(this.literalExpr) },
            // Array literal: [expr, ...]
            { ALT: () => this.SUBRULE(this.arrayCreateExpression) },
            // Object literal: { key: expr, ... }
            { ALT: () => this.SUBRULE(this.objectCreateExpression) },
            // Plain identifier (property ref)
            {
                ALT: () => {
                    const identifier = this.SUBRULE4(this.id);
                    return {
                        kind: 'PropertyRefScalarExpression' as const,
                        identifier,
                        range: identifier.range,
                    };
                },
            },
        ]);
    });

    // LET id = binary_expression IN binary_expression (comparison-level, matching C++)
    private letExpression = this.RULE('letExpression', (): AST.SqlLetScalarExpression => {
        const tok = this.CONSUME(T.Let);
        const idTok = this.CONSUME(T.Identifier);
        const identifier: AST.SqlIdentifier = { kind: 'Identifier', value: idTok.image, range: range(idTok, idTok) };
        this.CONSUME(T.Equals);
        const value = this.SUBRULE(this.comparisonExpression);
        this.CONSUME(T.In);
        const body = this.SUBRULE2(this.comparisonExpression);
        return {
            kind: 'LetScalarExpression',
            identifier,
            value,
            body,
            range: { start: pos(tok), end: body.range?.end ?? posEnd(tok) },
        };
    });

    // ======================== Array & Object create ===========================

    private arrayCreateExpression = this.RULE('arrayCreateExpression', (): AST.SqlArrayCreateScalarExpression => {
        const lb = this.CONSUME(T.LBracket);
        const items = this.SUBRULE(this.optScalarExpressionList);
        const rb = this.CONSUME(T.RBracket);
        return {
            kind: 'ArrayCreateScalarExpression',
            items,
            range: { start: pos(lb), end: posEnd(rb) },
        };
    });

    private objectCreateExpression = this.RULE('objectCreateExpression', (): AST.SqlObjectCreateScalarExpression => {
        const lb = this.CONSUME(T.LBrace);
        const properties: AST.SqlObjectProperty[] = [];
        this.OPTION(() => {
            properties.push(this.SUBRULE(this.objectProperty));
            this.MANY(() => {
                this.CONSUME(T.Comma);
                properties.push(this.SUBRULE2(this.objectProperty));
            });
        });
        const rb = this.CONSUME(T.RBrace);
        return {
            kind: 'ObjectCreateScalarExpression',
            properties,
            range: { start: pos(lb), end: posEnd(rb) },
        };
    });

    private objectProperty = this.RULE('objectProperty', (): AST.SqlObjectProperty => {
        const name = this.SUBRULE(this.propertyName);
        this.CONSUME(T.Colon);
        const value = this.SUBRULE(this.scalarExpression);
        return {
            kind: 'ObjectProperty',
            name,
            value,
            range: rangeFromNodes(name, value),
        };
    });

    private propertyName = this.RULE('propertyName', (): AST.SqlPropertyName => {
        return this.OR([
            {
                ALT: () => {
                    const tok = this.CONSUME(T.StringLiteral);
                    return { kind: 'PropertyName' as const, value: tok.image.slice(1, -1), range: range(tok, tok) };
                },
            },
            {
                ALT: () => {
                    const identifier = this.SUBRULE(this.id);
                    return { kind: 'PropertyName' as const, value: identifier.value, range: identifier.range };
                },
            },
        ]);
    });

    // ======================== Expression lists ================================

    private scalarExpressionList = this.RULE('scalarExpressionList', (): AST.SqlScalarExpression[] => {
        const items: AST.SqlScalarExpression[] = [];
        items.push(this.SUBRULE(this.scalarExpression));
        this.MANY(() => {
            this.CONSUME(T.Comma);
            items.push(this.SUBRULE2(this.scalarExpression));
        });
        return items;
    });

    private optScalarExpressionList = this.RULE('optScalarExpressionList', (): AST.SqlScalarExpression[] => {
        const items: AST.SqlScalarExpression[] = [];
        this.OPTION(() => {
            items.push(this.SUBRULE(this.scalarExpression));
            this.MANY(() => {
                this.CONSUME(T.Comma);
                items.push(this.SUBRULE2(this.scalarExpression));
            });
        });
        return items;
    });

    // ======================== Leaf helpers ====================================

    private id = this.RULE('id', (): AST.SqlIdentifier => {
        const tok = this.OR([
            { ALT: () => this.CONSUME(T.Identifier) },
            { ALT: () => this.CONSUME(T.Let) },
            { ALT: () => this.CONSUME(T.Rank) },
        ]);
        return { kind: 'Identifier', value: tok.image, range: range(tok, tok) };
    });

    private idOrKeywordFuncName = this.RULE('idOrKeywordFuncName', (): AST.SqlIdentifier => {
        const tok = this.OR([
            { ALT: () => this.CONSUME(T.Identifier) },
            { ALT: () => this.CONSUME(T.Let) },
            { ALT: () => this.CONSUME(T.Rank) },
            { ALT: () => this.CONSUME(T.Left) },
            { ALT: () => this.CONSUME(T.Right) },
        ]);
        return { kind: 'Identifier', value: tok.image, range: range(tok, tok) };
    });

    private numberLitExpr = this.RULE('numberLitExpr', (): AST.SqlLiteralScalarExpression => {
        const tok = this.CONSUME(T.NumberLiteral);
        return {
            kind: 'LiteralScalarExpression',
            literal: { kind: 'NumberLiteral', value: Number(tok.image), range: range(tok, tok) },
            range: range(tok, tok),
        };
    });

    private integerLitExpr = this.RULE('integerLitExpr', (): AST.SqlLiteralScalarExpression => {
        const tok = this.CONSUME(T.IntegerLiteral);
        return {
            kind: 'LiteralScalarExpression',
            literal: { kind: 'NumberLiteral', value: Number(tok.image), range: range(tok, tok) },
            range: range(tok, tok),
        };
    });

    private parameterRefExpr = this.RULE('parameterRefExpr', (): AST.SqlParameterRefScalarExpression => {
        const tok = this.CONSUME(T.Parameter);
        return {
            kind: 'ParameterRefScalarExpression',
            parameter: { kind: 'Parameter', name: tok.image, range: range(tok, tok) },
            range: range(tok, tok),
        };
    });

    private literalExpr = this.RULE('literalExpr', (): AST.SqlLiteralScalarExpression => {
        const literal: AST.SqlLiteral = this.OR<AST.SqlLiteral>([
            {
                ALT: () => {
                    const tok = this.CONSUME(T.StringLiteral);
                    return { kind: 'StringLiteral' as const, value: tok.image.slice(1, -1), range: range(tok, tok) };
                },
            },
            {
                ALT: () => {
                    const tok = this.CONSUME(T.NumberLiteral);
                    return { kind: 'NumberLiteral' as const, value: Number(tok.image), range: range(tok, tok) };
                },
            },
            {
                ALT: () => {
                    const tok = this.CONSUME(T.True_);
                    return { kind: 'BooleanLiteral' as const, value: true, range: range(tok, tok) };
                },
            },
            {
                ALT: () => {
                    const tok = this.CONSUME(T.False_);
                    return { kind: 'BooleanLiteral' as const, value: false, range: range(tok, tok) };
                },
            },
            {
                ALT: () => {
                    const tok = this.CONSUME(T.Null_);
                    return { kind: 'NullLiteral' as const, range: range(tok, tok) };
                },
            },
            {
                ALT: () => {
                    const tok = this.CONSUME(T.Undefined_);
                    return { kind: 'UndefinedLiteral' as const, range: range(tok, tok) };
                },
            },
        ]);
        return { kind: 'LiteralScalarExpression', literal, range: literal.range };
    });
}
