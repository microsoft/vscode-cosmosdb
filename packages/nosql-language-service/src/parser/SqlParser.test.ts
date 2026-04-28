/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parse, sqlToString } from '../index.js';

describe('SqlParser — basic queries', () => {
    it('parses SELECT * FROM c', () => {
        const { ast, errors } = parse('SELECT * FROM c');
        expect(errors).toHaveLength(0);
        expect(ast).toBeDefined();
        expect(ast!.kind).toBe('Program');
        expect(ast!.query.select.spec.kind).toBe('SelectStarSpec');
        expect(ast!.query.from).toBeDefined();
        expect(ast!.query.from!.collection.kind).toBe('AliasedCollectionExpression');
    });

    it('parses SELECT c.id, c.name FROM c', () => {
        const { ast, errors } = parse('SELECT c.id, c.name FROM c');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectListSpec');
        if (spec.kind === 'SelectListSpec') {
            expect(spec.items).toHaveLength(2);
        }
    });

    it('parses SELECT VALUE c.id FROM c', () => {
        const { ast, errors } = parse('SELECT VALUE c.id FROM c');
        expect(errors).toHaveLength(0);
        expect(ast!.query.select.spec.kind).toBe('SelectValueSpec');
    });

    it('parses SELECT DISTINCT TOP 10 * FROM c', () => {
        const { ast, errors } = parse('SELECT DISTINCT TOP 10 * FROM c');
        expect(errors).toHaveLength(0);
        expect(ast!.query.select.distinct).toBe(true);
        expect(ast!.query.select.top).toBeDefined();
    });

    it('parses WHERE clause', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE c.age > 21');
        expect(errors).toHaveLength(0);
        expect(ast!.query.where).toBeDefined();
        expect(ast!.query.where!.expression.kind).toBe('BinaryScalarExpression');
    });

    it('parses ORDER BY', () => {
        const { ast, errors } = parse('SELECT * FROM c ORDER BY c.name ASC');
        expect(errors).toHaveLength(0);
        expect(ast!.query.orderBy).toBeDefined();
        expect(ast!.query.orderBy!.items).toHaveLength(1);
        expect(ast!.query.orderBy!.items[0].sortOrder).toBe('Ascending');
    });

    it('parses OFFSET / LIMIT', () => {
        const { ast, errors } = parse('SELECT * FROM c OFFSET 5 LIMIT 10');
        expect(errors).toHaveLength(0);
        expect(ast!.query.offsetLimit).toBeDefined();
    });

    it('parses GROUP BY', () => {
        const { ast, errors } = parse('SELECT c.type FROM c GROUP BY c.type');
        expect(errors).toHaveLength(0);
        expect(ast!.query.groupBy).toBeDefined();
    });

    it('parses JOIN', () => {
        const { ast, errors } = parse('SELECT * FROM c JOIN t IN c.tags');
        expect(errors).toHaveLength(0);
        expect(ast!.query.from!.collection.kind).toBe('JoinCollectionExpression');
    });

    it('parses function call', () => {
        const { errors } = parse('SELECT ARRAY_LENGTH(c.items) FROM c');
        expect(errors).toHaveLength(0);
    });

    it('parses UDF call', () => {
        const { ast, errors } = parse('SELECT udf.myFunc(c.id) FROM c');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        if (spec.kind === 'SelectListSpec') {
            const expr = spec.items[0].expression;
            expect(expr.kind).toBe('FunctionCallScalarExpression');
            if (expr.kind === 'FunctionCallScalarExpression') {
                expect(expr.udf).toBe(true);
            }
        }
    });

    it('parses BETWEEN', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE c.age BETWEEN 18 AND 65');
        expect(errors).toHaveLength(0);
        expect(ast!.query.where!.expression.kind).toBe('BetweenScalarExpression');
    });

    it('parses IN', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE c.id IN (1, 2, 3)');
        expect(errors).toHaveLength(0);
        expect(ast!.query.where!.expression.kind).toBe('InScalarExpression');
    });

    it('parses LIKE', () => {
        const { ast, errors } = parse("SELECT * FROM c WHERE c.name LIKE '%test%'");
        expect(errors).toHaveLength(0);
        expect(ast!.query.where!.expression.kind).toBe('LikeScalarExpression');
    });

    it('parses EXISTS subquery', () => {
        const { ast, errors } = parse("SELECT * FROM c WHERE EXISTS(SELECT VALUE t FROM t IN c.tags WHERE t = 'red')");
        expect(errors).toHaveLength(0);
        expect(ast!.query.where!.expression.kind).toBe('ExistsScalarExpression');
    });

    it('parses array literal', () => {
        const { errors } = parse('SELECT [1, 2, 3] FROM c');
        expect(errors).toHaveLength(0);
    });

    it('parses object literal', () => {
        const { errors } = parse('SELECT {id: c.id, name: c.name} FROM c');
        expect(errors).toHaveLength(0);
    });

    it('parses parameter ref', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE c.id = @id');
        expect(errors).toHaveLength(0);
        const where = ast!.query.where!.expression;
        expect(where.kind).toBe('BinaryScalarExpression');
        if (where.kind === 'BinaryScalarExpression') {
            expect(where.right.kind).toBe('ParameterRefScalarExpression');
        }
    });

    it('parses ternary expression', () => {
        const { errors } = parse("SELECT c.active ? 'yes' : 'no' FROM c");
        expect(errors).toHaveLength(0);
    });

    it('parses coalesce ??', () => {
        const { errors } = parse("SELECT c.name ?? 'unknown' FROM c");
        expect(errors).toHaveLength(0);
    });

    it('stores source ranges on AST nodes', () => {
        const { ast } = parse('SELECT * FROM c');
        expect(ast!.range).toBeDefined();
        expect(ast!.range!.start.offset).toBe(0);
        expect(ast!.query.range).toBeDefined();
    });
});

describe('SqlParser — round-trip (parse → print → parse)', () => {
    const queries = [
        'SELECT * FROM c',
        'SELECT c.id, c.name FROM c',
        'SELECT VALUE c.id FROM c',
        'SELECT DISTINCT TOP 10 * FROM c',
        'SELECT * FROM c WHERE c.age > 21',
        'SELECT * FROM c ORDER BY c.name ASC',
        'SELECT * FROM c OFFSET 5 LIMIT 10',
        'SELECT * FROM c WHERE c.id = @id',
        'SELECT * FROM c WHERE c.age BETWEEN 18 AND 65',
        'SELECT * FROM c WHERE c.id IN (1, 2, 3)',
    ];

    for (const query of queries) {
        it(`round-trips: ${query}`, () => {
            const first = parse(query);
            expect(first.errors).toHaveLength(0);
            const printed = sqlToString(first.ast!);
            const second = parse(printed);
            expect(second.errors).toHaveLength(0);
            // Compare by printing again — structural equality
            expect(sqlToString(second.ast!)).toBe(sqlToString(first.ast!));
        });
    }
});

describe('SqlParser — error recovery', () => {
    it('returns errors for invalid query, does not throw', () => {
        const { errors } = parse('SELECT FROM');
        expect(errors.length).toBeGreaterThan(0);
        // With severe errors parser may not produce AST, but it must not throw
    });

    it('returns partial AST for recoverable errors', () => {
        const { ast, errors } = parse('SELECT * FORM c');
        expect(errors.length).toBeGreaterThan(0);
        expect(ast).toBeDefined();
    });

    it('reports error for incomplete query', () => {
        const { errors } = parse('SELECT');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('reports error for typo keyword', () => {
        const { errors } = parse('SELEC * FROM c');
        expect(errors.length).toBeGreaterThan(0);
    });
});

describe('SqlParser — grammar discrepancy fixes', () => {
    // Fix #6: select item alias accepts LET and RANK as identifiers
    it('accepts LET as select item alias', () => {
        const { ast, errors } = parse('SELECT c.x LET FROM c');
        expect(errors).toHaveLength(0);
        expect(ast!.query.select.spec.kind).toBe('SelectListSpec');
        if (ast!.query.select.spec.kind === 'SelectListSpec') {
            expect(ast!.query.select.spec.items[0].alias?.value).toBe('LET');
        }
    });

    it('accepts RANK as select item alias with AS', () => {
        const { ast, errors } = parse('SELECT c.x AS RANK FROM c');
        expect(errors).toHaveLength(0);
        if (ast!.query.select.spec.kind === 'SelectListSpec') {
            expect(ast!.query.select.spec.items[0].alias?.value).toBe('RANK');
        }
    });

    // Fix #5: ORDER BY RANK requires function call
    it('parses ORDER BY RANK with function call', () => {
        const { ast, errors } = parse('SELECT * FROM c ORDER BY RANK VectorDistance(c.vec, [1,2,3])');
        expect(errors).toHaveLength(0);
        expect(ast!.query.orderBy).toBeDefined();
        expect(ast!.query.orderBy!.isRank).toBe(true);
        expect(ast!.query.orderBy!.items[0].expression.kind).toBe('FunctionCallScalarExpression');
    });

    it('parses ORDER BY RANK with function call and ASC', () => {
        const { ast, errors } = parse('SELECT * FROM c ORDER BY RANK VectorDistance(c.vec, [1,2,3]) ASC');
        expect(errors).toHaveLength(0);
        expect(ast!.query.orderBy!.isRank).toBe(true);
        expect(ast!.query.orderBy!.items[0].sortOrder).toBe('Ascending');
    });

    // Fix #2: chained comparisons
    it('parses chained comparisons a = b = c', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE c.a = c.b = c.c');
        expect(errors).toHaveLength(0);
        // Left-associative: (c.a = c.b) = c.c
        const where = ast!.query.where!.expression;
        expect(where.kind).toBe('BinaryScalarExpression');
        if (where.kind === 'BinaryScalarExpression') {
            expect(where.left.kind).toBe('BinaryScalarExpression'); // (c.a = c.b)
        }
    });

    it('parses chained a < b < c', () => {
        const { errors } = parse('SELECT * FROM c WHERE c.x < c.y < c.z');
        expect(errors).toHaveLength(0);
    });

    // Fix #1: coalesce right-associativity
    it('parses coalesce a ?? b ?? c as right-associative', () => {
        const { ast, errors } = parse('SELECT a ?? b ?? c FROM items');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectListSpec');
        if (spec.kind === 'SelectListSpec') {
            const expr = spec.items[0].expression;
            // Right-associative: a ?? (b ?? c)
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.right.kind).toBe('CoalesceScalarExpression'); // (b ?? c) on the right
            }
        }
    });

    it('parses 1 + 2 ?? 3 with coalesce looser than additive operators', () => {
        const { ast, errors } = parse('SELECT VALUE 1 + 2 ?? 3');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.left.kind).toBe('BinaryScalarExpression');
                if (expr.left.kind === 'BinaryScalarExpression') {
                    expect(expr.left.operator).toBe('Add');
                }
            }
        }
    });

    it('parses 1 ?? 2 + 3 with coalesce looser than additive operators', () => {
        const { ast, errors } = parse('SELECT VALUE 1 ?? 2 + 3');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.right.kind).toBe('BinaryScalarExpression');
                if (expr.right.kind === 'BinaryScalarExpression') {
                    expect(expr.right.operator).toBe('Add');
                }
            }
        }
    });

    it('parses 1 = 2 ?? 3 with coalesce looser than comparison operators', () => {
        const { ast, errors } = parse('SELECT VALUE 1 = 2 ?? 3');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.left.kind).toBe('BinaryScalarExpression');
                if (expr.left.kind === 'BinaryScalarExpression') {
                    expect(expr.left.operator).toBe('Equal');
                }
            }
        }
    });

    it('parses 1 ?? 2 = 3 with coalesce looser than comparison operators', () => {
        const { ast, errors } = parse('SELECT VALUE 1 ?? 2 = 3');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.right.kind).toBe('BinaryScalarExpression');
                if (expr.right.kind === 'BinaryScalarExpression') {
                    expect(expr.right.operator).toBe('Equal');
                }
            }
        }
    });

    it('parses 1 AND 2 ?? 3 with coalesce looser than logical AND', () => {
        const { ast, errors } = parse('SELECT VALUE true AND false ?? true');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.left.kind).toBe('BinaryScalarExpression');
                if (expr.left.kind === 'BinaryScalarExpression') {
                    expect(expr.left.operator).toBe('And');
                }
            }
        }
    });

    it('parses 1 ?? 2 AND 3 with coalesce looser than logical AND', () => {
        const { ast, errors } = parse('SELECT VALUE true ?? false AND true');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.right.kind).toBe('BinaryScalarExpression');
                if (expr.right.kind === 'BinaryScalarExpression') {
                    expect(expr.right.operator).toBe('And');
                }
            }
        }
    });

    it('parses -1 ?? 2 with coalesce looser than unary minus', () => {
        const { ast, errors } = parse('SELECT VALUE -1 ?? 2');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.left.kind).toBe('LiteralScalarExpression');
            }
        }
    });

    it('parses ~1 ?? 2 with coalesce looser than unary bitwise not', () => {
        const { ast, errors } = parse('SELECT VALUE ~1 ?? 2');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.left.kind).toBe('UnaryScalarExpression');
                if (expr.left.kind === 'UnaryScalarExpression') {
                    expect(expr.left.operator).toBe('BitwiseNot');
                }
            }
        }
    });

    it('parses NOT 1 ?? 2 with coalesce looser than unary NOT', () => {
        const { ast, errors } = parse('SELECT VALUE NOT 1 ?? 2');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('CoalesceScalarExpression');
            if (expr.kind === 'CoalesceScalarExpression') {
                expect(expr.left.kind).toBe('UnaryScalarExpression');
                if (expr.left.kind === 'UnaryScalarExpression') {
                    expect(expr.left.operator).toBe('Not');
                }
            }
        }
    });

    // Fix #3: BETWEEN/LIKE/LET bounds accept full binary expressions
    it('parses LIKE with || string concat in pattern', () => {
        const { ast, errors } = parse("SELECT * FROM c WHERE c.name LIKE c.prefix || '%'");
        expect(errors).toHaveLength(0);
        const where = ast!.query.where!.expression;
        expect(where.kind).toBe('LikeScalarExpression');
        if (where.kind === 'LikeScalarExpression') {
            // pattern should be a StringConcat binary expression
            expect(where.pattern.kind).toBe('BinaryScalarExpression');
        }
    });

    it('parses NOT LIKE with || string concat', () => {
        const { ast, errors } = parse("SELECT * FROM c WHERE c.name NOT LIKE c.prefix || '%'");
        expect(errors).toHaveLength(0);
        expect(ast!.query.where!.expression.kind).toBe('LikeScalarExpression');
    });

    it('parses BETWEEN with comparison in bounds', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE c.x BETWEEN 1 | 2 AND 3 | 4');
        expect(errors).toHaveLength(0);
        expect(ast!.query.where!.expression.kind).toBe('BetweenScalarExpression');
    });

    it('rejects bare BETWEEN combined with AND without parentheses', () => {
        const { errors } = parse('SELECT * FROM c WHERE c.x BETWEEN 1 AND 2 AND c.y = 3');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects bare NOT BETWEEN combined with AND without parentheses', () => {
        const { errors } = parse('SELECT * FROM c WHERE c.x NOT BETWEEN 1 AND 2 AND c.y = 3');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects bare prefix-NOT with BETWEEN combined with AND without parentheses', () => {
        const { errors } = parse('SELECT * FROM c WHERE NOT c.x BETWEEN 1 AND 2 AND c.y = 3');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts parenthesized BETWEEN combined with AND', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE (c.x BETWEEN 1 AND 2) AND c.y = 3');
        expect(errors).toHaveLength(0);
        expect(ast!.query.where!.expression.kind).toBe('BinaryScalarExpression');
    });

    it('keeps IN combined with AND valid', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE c.x IN (1, 2) AND c.y = 3');
        expect(errors).toHaveLength(0);
        expect(ast!.query.where!.expression.kind).toBe('BinaryScalarExpression');
    });

    it('keeps LIKE combined with AND valid', () => {
        const { ast, errors } = parse("SELECT * FROM c WHERE c.x LIKE 'a%' AND c.y = 3");
        expect(errors).toHaveLength(0);
        expect(ast!.query.where!.expression.kind).toBe('BinaryScalarExpression');
    });

    it('parses LET with comparison in value and body', () => {
        const { errors } = parse('SELECT * FROM c WHERE (LET x = c.a > 1 IN x)');
        expect(errors).toHaveLength(0);
    });

    // Fix #4: OFFSET/LIMIT only accept integers
    it('parses OFFSET/LIMIT with integers', () => {
        const { ast, errors } = parse('SELECT * FROM c OFFSET 5 LIMIT 10');
        expect(errors).toHaveLength(0);
        expect(ast!.query.offsetLimit).toBeDefined();
    });

    it('rejects OFFSET with float', () => {
        const { errors } = parse('SELECT * FROM c OFFSET 3.14 LIMIT 10');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('rejects LIMIT with float', () => {
        const { errors } = parse('SELECT * FROM c OFFSET 0 LIMIT 2.5');
        expect(errors.length).toBeGreaterThan(0);
    });

    it('accepts OFFSET/LIMIT with parameters', () => {
        const { ast, errors } = parse('SELECT * FROM c OFFSET @skip LIMIT @take');
        expect(errors).toHaveLength(0);
        expect(ast!.query.offsetLimit).toBeDefined();
    });

    it('still allows floats in TOP (matching C++)', () => {
        const { ast, errors } = parse('SELECT TOP 3.0 * FROM c');
        expect(errors).toHaveLength(0);
        expect(ast!.query.select.top).toBeDefined();
    });

    it('parses 1 | 2 + 3 with C++ same-level precedence', () => {
        const { ast, errors } = parse('SELECT VALUE 1 | 2 + 3');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('BinaryScalarExpression');
            if (expr.kind === 'BinaryScalarExpression') {
                expect(expr.operator).toBe('Add');
                expect(expr.left.kind).toBe('BinaryScalarExpression');
                if (expr.left.kind === 'BinaryScalarExpression') {
                    expect(expr.left.operator).toBe('BitwiseOr');
                }
            }
        }
    });

    it('parses 1 + 2 | 3 with C++ same-level precedence', () => {
        const { ast, errors } = parse('SELECT VALUE 1 + 2 | 3');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('BinaryScalarExpression');
            if (expr.kind === 'BinaryScalarExpression') {
                expect(expr.operator).toBe('BitwiseOr');
                expect(expr.left.kind).toBe('BinaryScalarExpression');
                if (expr.left.kind === 'BinaryScalarExpression') {
                    expect(expr.left.operator).toBe('Add');
                }
            }
        }
    });

    it('parses 1 & 2 + 3 with C++ same-level precedence', () => {
        const { ast, errors } = parse('SELECT VALUE 1 & 2 + 3');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('BinaryScalarExpression');
            if (expr.kind === 'BinaryScalarExpression') {
                expect(expr.operator).toBe('Add');
                expect(expr.left.kind).toBe('BinaryScalarExpression');
                if (expr.left.kind === 'BinaryScalarExpression') {
                    expect(expr.left.operator).toBe('BitwiseAnd');
                }
            }
        }
    });

    it('keeps multiplicative operators tighter than same-level bitwise/additive operators', () => {
        const { ast, errors } = parse('SELECT VALUE 1 + 2 * 3 | 4');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            expect(expr.kind).toBe('BinaryScalarExpression');
            if (expr.kind === 'BinaryScalarExpression') {
                expect(expr.operator).toBe('BitwiseOr');
                expect(expr.left.kind).toBe('BinaryScalarExpression');
                if (expr.left.kind === 'BinaryScalarExpression') {
                    expect(expr.left.operator).toBe('Add');
                    expect(expr.left.right.kind).toBe('BinaryScalarExpression');
                    if (expr.left.right.kind === 'BinaryScalarExpression') {
                        expect(expr.left.right.operator).toBe('Multiply');
                    }
                }
            }
        }
    });

    it('parses NOT 1 = 2 as (NOT 1) = 2, matching C++ unary precedence', () => {
        const { ast, errors } = parse('SELECT VALUE NOT 1 = 2');
        expect(errors).toHaveLength(0);
        const spec = ast!.query.select.spec;
        expect(spec.kind).toBe('SelectValueSpec');
        if (spec.kind === 'SelectValueSpec') {
            const expr = spec.expression;
            // C++ sql.y: NOT is at unary_expression level, so NOT binds first
            expect(expr.kind).toBe('BinaryScalarExpression');
            if (expr.kind === 'BinaryScalarExpression') {
                expect(expr.operator).toBe('Equal');
                expect(expr.left.kind).toBe('UnaryScalarExpression');
                if (expr.left.kind === 'UnaryScalarExpression') {
                    expect(expr.left.operator).toBe('Not');
                }
            }
        }
    });

    it('parses NOT c.x IN (...) as (NOT c.x) IN (...), matching C++ unary precedence', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE NOT c.x IN (1, 2)');
        expect(errors).toHaveLength(0);
        const expr = ast!.query.where!.expression;
        // C++ sql.y: NOT is at unary level, binds only to c.x
        expect(expr.kind).toBe('InScalarExpression');
        if (expr.kind === 'InScalarExpression') {
            expect(expr.expression.kind).toBe('UnaryScalarExpression');
            if (expr.expression.kind === 'UnaryScalarExpression') {
                expect(expr.expression.operator).toBe('Not');
            }
        }
    });

    it('parses NOT c.x BETWEEN ... as (NOT c.x) BETWEEN ..., matching C++ unary precedence', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE NOT c.x BETWEEN 1 AND 2');
        expect(errors).toHaveLength(0);
        const expr = ast!.query.where!.expression;
        // C++ sql.y: NOT is at unary level, binds only to c.x
        expect(expr.kind).toBe('BetweenScalarExpression');
        if (expr.kind === 'BetweenScalarExpression') {
            expect(expr.expression.kind).toBe('UnaryScalarExpression');
            if (expr.expression.kind === 'UnaryScalarExpression') {
                expect(expr.expression.operator).toBe('Not');
            }
        }
    });

    it('parses NOT c.x LIKE ... as (NOT c.x) LIKE ..., matching C++ unary precedence', () => {
        const { ast, errors } = parse("SELECT * FROM c WHERE NOT c.x LIKE 'a%'");
        expect(errors).toHaveLength(0);
        const expr = ast!.query.where!.expression;
        // C++ sql.y: NOT is at unary level, binds only to c.x
        expect(expr.kind).toBe('LikeScalarExpression');
        if (expr.kind === 'LikeScalarExpression') {
            expect(expr.expression.kind).toBe('UnaryScalarExpression');
            if (expr.expression.kind === 'UnaryScalarExpression') {
                expect(expr.expression.operator).toBe('Not');
            }
        }
    });

    it('parses NOT a AND b as (NOT a) AND b, matching C++ unary precedence', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE NOT c.a AND c.b');
        expect(errors).toHaveLength(0);
        const expr = ast!.query.where!.expression;
        expect(expr.kind).toBe('BinaryScalarExpression');
        if (expr.kind === 'BinaryScalarExpression') {
            expect(expr.operator).toBe('And');
            expect(expr.left.kind).toBe('UnaryScalarExpression');
            if (expr.left.kind === 'UnaryScalarExpression') {
                expect(expr.left.operator).toBe('Not');
            }
        }
    });

    it('parses repeated NOT recursively', () => {
        const { ast, errors } = parse('SELECT * FROM c WHERE NOT NOT c.a');
        expect(errors).toHaveLength(0);
        const expr = ast!.query.where!.expression;
        expect(expr.kind).toBe('UnaryScalarExpression');
        if (expr.kind === 'UnaryScalarExpression') {
            expect(expr.operator).toBe('Not');
            expect(expr.operand.kind).toBe('UnaryScalarExpression');
            if (expr.operand.kind === 'UnaryScalarExpression') {
                expect(expr.operand.operator).toBe('Not');
            }
        }
    });
});
