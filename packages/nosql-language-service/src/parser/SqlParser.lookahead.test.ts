/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EarlyExitException, type IToken, MismatchedTokenException, NoViableAltException } from 'chevrotain';
import { writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type SqlProgram } from '../ast/nodes.js';
import { parse, sqlToString } from '../index.js';
import { SqlLexer } from '../lexer/SqlLexer.js';
import * as T from '../lexer/tokens.js';
import { lookaheadScenarios } from '../test-fixtures/queries/lookahead-stress.js';
import { fixtures as negativeFixtures } from '../test-fixtures/queries/negative-parser.js';
import { fixtures as basicFixtures } from '../test-fixtures/queries/select-basic.js';
import { fixtures as complexFixtures } from '../test-fixtures/queries/select-complex.js';
import { fixtures as joinFixtures } from '../test-fixtures/queries/select-from-join.js';
import { fixtures as functionFixtures } from '../test-fixtures/queries/select-functions.js';
import { fixtures as groupingFixtures } from '../test-fixtures/queries/select-groupby-orderby.js';
import { fixtures as conversionFixtures } from '../test-fixtures/queries/select-type-conversion.js';
import { fixtures as whereFixtures } from '../test-fixtures/queries/select-where.js';
import { exceedsAstDepth, MAX_AST_DEPTH, QueryTooComplexError } from './queryComplexity.js';
import { SqlParser } from './SqlParser.js';

function nodeKinds(value: unknown, kinds = new Set<string>()): Set<string> {
    if (Array.isArray(value)) {
        value.forEach((item) => nodeKinds(item, kinds));
    } else if (value && typeof value === 'object') {
        if ('kind' in value && typeof value.kind === 'string') kinds.add(value.kind);
        Object.values(value).forEach((item) => nodeKinds(item, kinds));
    }
    return kinds;
}

describe('SqlParser — complex lookahead scenarios', () => {
    it.each(lookaheadScenarios)('$id: $description', ({ query, expectedKinds }) => {
        const result = parse(query);
        expect(result.errors).toEqual([]);
        expect(result.ast).toBeDefined();
        expect([...nodeKinds(result.ast)]).toEqual(expect.arrayContaining(expectedKinds));
    });
});

type InputKind = 'complete' | 'negative' | 'prefix' | 'mutation' | 'complexity';
interface ComparisonInput {
    id: string;
    kind: InputKind;
    query: string;
}

function comparisonInputs(): ComparisonInput[] {
    const inputs = new Map<string, ComparisonInput>();
    const add = (input: ComparisonInput) => {
        if (!inputs.has(input.query)) inputs.set(input.query, input);
    };
    const complete = [
        ...basicFixtures,
        ...complexFixtures,
        ...joinFixtures,
        ...functionFixtures,
        ...groupingFixtures,
        ...conversionFixtures,
        ...whereFixtures,
        ...lookaheadScenarios,
    ];
    for (const { id, query } of complete) add({ id, kind: 'complete', query });
    for (const { id, query } of negativeFixtures) add({ id, kind: 'negative', query });
    for (const { id, query } of complete) {
        const { tokens } = SqlLexer.tokenize(query);
        add({ id: `${id}:empty`, kind: 'prefix', query: '' });
        for (const [index, token] of tokens.entries()) {
            add({
                id: `${id}:prefix-${index}`,
                kind: 'prefix',
                query: query.slice(0, token.startOffset + token.image.length),
            });
        }
    }
    // Delete branch introducers/operators and replace closing delimiters; edits need not remain invalid.
    const mutationTokens = new Set([
        T.Select,
        T.Value,
        T.From,
        T.Where,
        T.Join,
        T.In,
        T.And,
        T.Or,
        T.Not,
        T.Between,
        T.Rank,
        T.LParen,
        T.RParen,
        T.LBracket,
        T.RBracket,
        T.LBrace,
        T.RBrace,
        T.Comma,
        T.Dot,
        T.Equals,
        T.Question,
        T.Colon,
    ]);
    for (const { id, query } of lookaheadScenarios) {
        for (const [index, token] of SqlLexer.tokenize(query).tokens.entries()) {
            if (!mutationTokens.has(token.tokenType)) continue;
            const before = query.slice(0, token.startOffset);
            const after = query.slice(token.startOffset + token.image.length);
            add({ id: `${id}:delete-${index}`, kind: 'mutation', query: `${before} ${after}` });
            if (['RParen', 'RBracket', 'RBrace'].includes(token.tokenType.name)) {
                const replacement = token.image === ')' ? ']' : ')';
                add({ id: `${id}:delimiter-${index}`, kind: 'mutation', query: before + replacement + after });
            }
        }
    }
    for (const terms of [MAX_AST_DEPTH - 6, MAX_AST_DEPTH - 5, MAX_AST_DEPTH - 4]) {
        add({
            id: `ast-depth-${terms}`,
            kind: 'complexity',
            query: `SELECT VALUE ${Array(terms).fill('1').join(' + ')}`,
        });
    }
    for (const depth of [8, 16, 24, 32, 1000]) {
        for (const [name, open, close] of [
            ['parens', '(', ')'],
            ['calls', 'ABS(', ')'],
            ['arrays', '[', ']'],
        ]) {
            add({
                id: `${name}-${depth}`,
                kind: 'complexity',
                query: `SELECT VALUE ${open.repeat(depth)}1${close.repeat(depth)}`,
            });
        }
    }
    return [...inputs.values()];
}

function tokenSnapshot(token: IToken) {
    return {
        type: token.tokenType.name,
        image: token.image,
        startOffset: token.startOffset,
        endOffset: token.endOffset,
        startLine: token.startLine,
        endLine: token.endLine,
        startColumn: token.startColumn,
        endColumn: token.endColumn,
    };
}

function outcome(parser: SqlParser, query: string) {
    const lexed = SqlLexer.tokenize(query);
    parser.input = lexed.tokens;
    let ast: SqlProgram | undefined;
    let exception: { name: string; message: string } | undefined;
    let complexity: { reason: string; token?: ReturnType<typeof tokenSnapshot> } | undefined;
    try {
        ast = parser.program();
    } catch (error) {
        if (error instanceof QueryTooComplexError) {
            complexity = { reason: error.message, token: tokenSnapshot(error.token) };
        } else {
            // Preserve unexpected exceptions as explicit comparison failures, never as parse success.
            exception = { name: error instanceof Error ? error.name : 'Unknown', message: String(error) };
        }
    }
    const parserErrors = parser.errors.map((error) => ({
        name: error.name,
        message: error.message,
        token: tokenSnapshot(error.token),
        previousToken:
            error instanceof MismatchedTokenException ||
            error instanceof NoViableAltException ||
            error instanceof EarlyExitException
                ? tokenSnapshot(error.previousToken)
                : undefined,
        resyncedTokens: error.resyncedTokens.map(tokenSnapshot),
        context: error.context,
    }));
    return {
        ast,
        lexerErrors: lexed.errors,
        parserErrors,
        complexity,
        exceedsAstDepth: exceedsAstDepth(ast),
        exception,
    };
}

const compareLookahead = process.env.COSMOSDB_COMPARE_LOOKAHEAD === '1';
const inputs = compareLookahead ? comparisonInputs() : [];

describe.skipIf(!compareLookahead)('SqlParser — differential lookahead', () => {
    let current: SqlParser;
    let baseline: SqlParser;
    const timings: Record<string, { count: number; currentMs: number; baselineMs: number }> = {};
    const differences: object[] = [];
    const unexpectedExceptions: object[] = [];
    const roundTripFailures: object[] = [];
    const roundTripDifferences: object[] = [];
    const constructionMs = { current: 0, baseline: 0 };

    beforeAll(() => {
        let start = performance.now();
        current = new SqlParser();
        constructionMs.current = performance.now() - start;
        start = performance.now();
        baseline = new SqlParser(3);
        constructionMs.baseline = performance.now() - start;
    });

    afterAll(() => {
        const report = {
            inputCount: inputs.length,
            constructionMs,
            timings,
            differences,
            unexpectedExceptions,
            roundTripFailures,
            roundTripDifferences,
        };
        const reportPath = process.env.COSMOSDB_LOOKAHEAD_REPORT;
        if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(
            '[lookahead comparison]',
            JSON.stringify({
                inputCount: inputs.length,
                constructionMs,
                timings,
                differences: differences.length,
                unexpectedExceptions: unexpectedExceptions.length,
                roundTripFailures: roundTripFailures.length,
                roundTripDifferences: roundTripDifferences.length,
            }),
        );
    });

    it.each(inputs)('$kind $id', (input) => {
        const timing = (timings[input.kind] ??= { count: 0, currentMs: 0, baselineMs: 0 });
        let start = performance.now();
        const oldResult = outcome(baseline, input.query);
        timing.baselineMs += performance.now() - start;
        start = performance.now();
        const newResult = outcome(current, input.query);
        timing.currentMs += performance.now() - start;
        timing.count++;

        if (!isDeepStrictEqual(newResult, oldResult)) {
            differences.push({ ...input, baseline: oldResult, current: newResult });
        }
        if (newResult.exception || oldResult.exception) {
            unexpectedExceptions.push({ ...input, baseline: oldResult.exception, current: newResult.exception });
        }
        let oldPrintedResult: { printed: string; result: ReturnType<typeof outcome> } | undefined;
        let newPrintedResult: typeof oldPrintedResult;
        if (input.kind === 'complete' && oldResult.ast && newResult.ast) {
            const oldPrinted = sqlToString(oldResult.ast);
            const newPrinted = sqlToString(newResult.ast);
            const oldRoundTrip = outcome(baseline, oldPrinted);
            const newRoundTrip = outcome(current, newPrinted);
            oldPrintedResult = { printed: oldPrinted, result: oldRoundTrip };
            newPrintedResult = { printed: newPrinted, result: newRoundTrip };
            if (
                oldRoundTrip.parserErrors.length ||
                newRoundTrip.parserErrors.length ||
                oldRoundTrip.exception ||
                newRoundTrip.exception
            ) {
                roundTripFailures.push({
                    ...input,
                    baseline: oldPrintedResult,
                    current: newPrintedResult,
                });
            }
            if (!isDeepStrictEqual(newPrintedResult, oldPrintedResult)) {
                roundTripDifferences.push({ ...input, baseline: oldPrintedResult, current: newPrintedResult });
            }
        }
        expect(newPrintedResult).toStrictEqual(oldPrintedResult);
        expect(newResult).toStrictEqual(oldResult);
        expect(newResult.exception).toBeUndefined();
    });
});
