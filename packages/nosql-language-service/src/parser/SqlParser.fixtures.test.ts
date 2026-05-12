/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fixture-driven parser tests for Phases 2a–2d.
 *
 * Each fixture array is iterated: parse(query) must produce zero errors
 * and ast.query must match the partial expectAst via toMatchObject.
 *
 * Series covered:
 *   S  — basic SELECT (star, list, value, distinct, top, literals)
 *   F  — FROM and aliases
 *   J  — JOIN and array iterators
 *   W  — WHERE comparisons (all operators, AND / OR / NOT)
 *   B  — BETWEEN, IN, LIKE (including NOT variants and combinations)
 *   T  — Type-checking functions (IS_NULL, IS_DEFINED, IS_STRING, …)
 *   E  — EXISTS / NOT EXISTS subqueries
 *   STR / M / A / D  — string, math, array, date functions
 *   O / G / P  — ORDER BY, GROUP BY + aggregations, OFFSET LIMIT
 *   SQ / OP / PR / UDF / CX  — subqueries, operators, parameters, UDFs, complex
 *   N  — negative parser tests (queries that must produce parse errors)
 */

import { describe, expect, it } from 'vitest';
import { parse } from '../index.js';
import type { NegativeParserFixture, QueryFixture } from '../test-fixtures/queries/types.js';
import { fixtures as selectBasicFixtures } from '../test-fixtures/queries/select-basic.js';
import { fixtures as selectFromJoinFixtures } from '../test-fixtures/queries/select-from-join.js';
import { fixtures as selectWhereFixtures } from '../test-fixtures/queries/select-where.js';
import { fixtures as selectFunctionsFixtures } from '../test-fixtures/queries/select-functions.js';
import { fixtures as selectGroupByOrderByFixtures } from '../test-fixtures/queries/select-groupby-orderby.js';
import { fixtures as selectComplexFixtures } from '../test-fixtures/queries/select-complex.js';
import { fixtures as negativeParserFixtures } from '../test-fixtures/queries/negative-parser.js';

// ========================== Parametric runners ================================

function runFixtures(suiteName: string, fixtures: QueryFixture[]): void {
    describe(suiteName, () => {
        for (const f of fixtures) {
            it(`${f.id}: ${f.description}`, () => {
                const { ast, errors } = parse(f.query);

                expect(errors, `[${f.id}] must parse without errors — query: ${f.query}`).toHaveLength(0);
                expect(ast, `[${f.id}] AST must be defined`).toBeDefined();

                if (f.expectAst) {
                    expect(ast!.query).toMatchObject(f.expectAst);
                }
            });
        }
    });
}

function runNegativeFixtures(suiteName: string, fixtures: NegativeParserFixture[]): void {
    describe(suiteName, () => {
        for (const f of fixtures) {
            it(`${f.id}: ${f.description}`, () => {
                const result = parse(f.query);
                expect(result.errors.length, `[${f.id}] expected parse errors for: ${f.query}`).toBeGreaterThan(0);
                if (f.errorContains) {
                    expect(result.errors[0].message).toContain(f.errorContains);
                }
            });
        }
    });
}

// ========================== Test suites =======================================

describe('SqlParser — fixture-driven (Phase 2a)', () => {
    runFixtures('S + F series: basic SELECT and FROM', selectBasicFixtures);
    runFixtures('J series: JOIN and array iterators', selectFromJoinFixtures);
    runFixtures('W series: WHERE comparisons', selectWhereFixtures.filter((f) => f.id.startsWith('W')));
    runFixtures('B series: BETWEEN, IN, LIKE', selectWhereFixtures.filter((f) => f.id.startsWith('B')));
    runFixtures('T series: type-checking functions', selectWhereFixtures.filter((f) => f.id.startsWith('T')));
    runFixtures('E series: EXISTS subquery', selectWhereFixtures.filter((f) => f.id.startsWith('E')));
});

describe('SqlParser — fixture-driven (Phase 2b: functions)', () => {
    runFixtures('STR series: string functions', selectFunctionsFixtures.filter((f) => f.id.startsWith('STR')));
    runFixtures('M series: math functions', selectFunctionsFixtures.filter((f) => f.id.startsWith('M')));
    runFixtures('A series: array functions', selectFunctionsFixtures.filter((f) => f.id.startsWith('A')));
    runFixtures('D series: date / time functions', selectFunctionsFixtures.filter((f) => f.id.startsWith('D')));
});

describe('SqlParser — fixture-driven (Phase 2c: aggregations + complex)', () => {
    runFixtures('O series: ORDER BY', selectGroupByOrderByFixtures.filter((f) => f.id.startsWith('O')));
    runFixtures('G series: GROUP BY + aggregations', selectGroupByOrderByFixtures.filter((f) => f.id.startsWith('G')));
    runFixtures('P series: OFFSET / LIMIT', selectGroupByOrderByFixtures.filter((f) => f.id.startsWith('P')));
    runFixtures('SQ series: scalar subqueries', selectComplexFixtures.filter((f) => f.id.startsWith('SQ')));
    runFixtures('OP series: operators', selectComplexFixtures.filter((f) => f.id.startsWith('OP')));
    runFixtures('PR series: parameters', selectComplexFixtures.filter((f) => f.id.startsWith('PR')));
    runFixtures('UDF series: user-defined functions', selectComplexFixtures.filter((f) => f.id.startsWith('UDF')));
    runFixtures('CX series: complex / compositional', selectComplexFixtures.filter((f) => f.id.startsWith('CX')));
});

describe('SqlParser — fixture-driven (Phase 2d: negative parser tests)', () => {
    runNegativeFixtures('N series: parser errors', negativeParserFixtures);
});
