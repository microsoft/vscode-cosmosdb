/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Fixture-driven parser tests for Phase 2a.
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
 */

import { describe, expect, it } from 'vitest';
import { parse } from '../index.js';
import type { QueryFixture } from '../test-fixtures/queries/types.js';
import { fixtures as selectBasicFixtures } from '../test-fixtures/queries/select-basic.js';
import { fixtures as selectFromJoinFixtures } from '../test-fixtures/queries/select-from-join.js';
import { fixtures as selectWhereFixtures } from '../test-fixtures/queries/select-where.js';

// ========================== Parametric runner =================================

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

// ========================== Test suites =======================================

describe('SqlParser — fixture-driven (Phase 2a)', () => {
    runFixtures('S + F series: basic SELECT and FROM', selectBasicFixtures);
    runFixtures('J series: JOIN and array iterators', selectFromJoinFixtures);
    runFixtures('W series: WHERE comparisons', selectWhereFixtures.filter((f) => f.id.startsWith('W')));
    runFixtures('B series: BETWEEN, IN, LIKE', selectWhereFixtures.filter((f) => f.id.startsWith('B')));
    runFixtures('T series: type-checking functions', selectWhereFixtures.filter((f) => f.id.startsWith('T')));
    runFixtures('E series: EXISTS subquery', selectWhereFixtures.filter((f) => f.id.startsWith('E')));
});

