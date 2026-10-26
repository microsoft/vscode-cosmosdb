/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    EarlyExitException,
    type EmbeddedActionsParser,
    getLookaheadPaths,
    type IParserErrorMessageProvider,
    type IRecognitionException,
    type IToken,
    MismatchedTokenException,
    NoViableAltException,
    type Rule,
    type TokenType,
} from 'chevrotain';
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

// Investigation-only adapter: these runtime hooks are not part of Chevrotain's public extension API.
// Keep it in this excluded test file; a production solution should implement caching upstream.
interface DiagnosticInternals {
    maxLookahead: number;
    errorMessageProvider: IParserErrorMessageProvider;
    getCurrRuleFullName(): string;
    LA(howMuch: number): IToken;
    SAVE_ERROR(error: IRecognitionException): IRecognitionException;
    raiseNoAltException(occurrence: number, customDescription?: string): never;
}

function diagnosticInternals(parser: EmbeddedActionsParser): DiagnosticInternals {
    const value: unknown = parser;
    function hasInternals(candidate: unknown): candidate is DiagnosticInternals {
        if (!candidate || typeof candidate !== 'object') return false;
        const provider: unknown = Reflect.get(candidate, 'errorMessageProvider');
        return (
            typeof Reflect.get(candidate, 'maxLookahead') === 'number' &&
            ['getCurrRuleFullName', 'LA', 'SAVE_ERROR', 'raiseNoAltException'].every(
                (name) => typeof Reflect.get(candidate, name) === 'function',
            ) &&
            typeof provider === 'object' &&
            provider !== null &&
            typeof Reflect.get(provider, 'buildNoViableAltMessage') === 'function'
        );
    }
    if (!hasInternals(value)) {
        throw new Error('The diagnostic cache prototype requires Chevrotain 13.2-compatible runtime hooks.');
    }
    return value;
}

function installDiagnosticCachePrototype(parser: EmbeddedActionsParser) {
    const internals = diagnosticInternals(parser);
    const original = internals.raiseNoAltException;
    const paths = new Map<Rule, Map<string, TokenType[][][]>>();
    const stats = { errors: 0, pathComputations: 0 };

    internals.raiseNoAltException = (occurrence, customDescription): never => {
        const ruleName = internals.getCurrRuleFullName();
        const rule = parser.getGAstProductions()[ruleName];
        let byOccurrence = paths.get(rule);
        if (!byOccurrence) {
            byOccurrence = new Map();
            paths.set(rule, byOccurrence);
        }
        const key = `${occurrence}:${internals.maxLookahead}`;
        let expectedPathsPerAlt = byOccurrence.get(key);
        if (!expectedPathsPerAlt) {
            expectedPathsPerAlt = getLookaheadPaths({
                occurrence,
                rule,
                prodType: 'Alternation',
                maxLookahead: internals.maxLookahead,
            });
            byOccurrence.set(key, expectedPathsPerAlt);
            stats.pathComputations++;
        }
        stats.errors++;
        const actual = Array.from({ length: internals.maxLookahead }, (_, index) => internals.LA(index + 1));
        const previous = internals.LA(0);
        const message = internals.errorMessageProvider.buildNoViableAltMessage({
            expectedPathsPerAlt,
            actual,
            previous,
            customUserDescription: customDescription,
            ruleName,
        });
        throw internals.SAVE_ERROR(new NoViableAltException(message, internals.LA(1), previous));
    };

    return {
        stats,
        restore() {
            internals.raiseNoAltException = original;
            paths.clear();
        },
    };
}

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
const compareDiagnosticCache = process.env.COSMOSDB_COMPARE_DIAGNOSTIC_CACHE === '1';
const inputs = compareLookahead ? comparisonInputs() : [];

describe.skipIf(!compareDiagnosticCache)('SqlParser — diagnostic cache isolation', () => {
    it('reuses grammar paths across inputs without reusing diagnostic token positions', () => {
        const parser = new SqlParser(3);
        const cache = installDiagnosticCachePrototype(parser);
        try {
            const first = outcome(parser, 'SELECT * FROM c WHERE');
            const computations = cache.stats.pathComputations;
            const second = outcome(parser, 'SELECT c.id\nFROM c\nWHERE');
            expect(first.parserErrors).toHaveLength(1);
            expect(second.parserErrors).toHaveLength(1);
            expect(computations).toBeGreaterThan(0);
            expect(cache.stats.pathComputations).toBe(computations);
            expect(cache.stats.errors).toBe(2);
            expect(second.parserErrors[0].message).toBe(first.parserErrors[0].message);
            expect(first.parserErrors[0].previousToken?.startLine).toBe(1);
            expect(second.parserErrors[0].previousToken?.startLine).toBe(3);
            expect(outcome(parser, 'SELECT * FROM c').parserErrors).toEqual([]);
        } finally {
            cache.restore();
        }
    });
});

describe.skipIf(!compareLookahead)('SqlParser — differential lookahead', () => {
    let current: SqlParser;
    let baseline: SqlParser;
    let cache: ReturnType<typeof installDiagnosticCachePrototype> | undefined;
    const timings: Record<string, { count: number; currentMs: number; baselineMs: number }> = {};
    const differences: object[] = [];
    const unexpectedExceptions: object[] = [];
    const roundTripFailures: object[] = [];
    const roundTripDifferences: object[] = [];
    const constructionMs = { current: 0, baseline: 0 };

    beforeAll(() => {
        let start = performance.now();
        current = compareDiagnosticCache ? new SqlParser(3) : new SqlParser();
        if (compareDiagnosticCache) cache = installDiagnosticCachePrototype(current);
        constructionMs.current = performance.now() - start;
        start = performance.now();
        baseline = new SqlParser(3);
        constructionMs.baseline = performance.now() - start;
    });

    afterAll(() => {
        const report = {
            mode: compareDiagnosticCache ? 'cached-diagnostics' : 'two-token-lookahead',
            cache: cache?.stats,
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
                mode: report.mode,
                cache: report.cache,
                constructionMs,
                timings,
                differences: differences.length,
                unexpectedExceptions: unexpectedExceptions.length,
                roundTripFailures: roundTripFailures.length,
                roundTripDifferences: roundTripDifferences.length,
            }),
        );
        cache?.restore();
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
