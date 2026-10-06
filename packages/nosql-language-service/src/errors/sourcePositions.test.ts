/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { parse, SqlErrorCode, SqlLanguageService } from '../index.js';

describe('UTF-16 source coordinates', () => {
    it.each(['\n', '\r\n', '\r'])('uses a zero-width EOF range after %j', (newline) => {
        const query = `SELECT VALUE "\uD83D\uDE00"${newline}FROM`;
        const error = parse(query).errors.find((e) => e.code === SqlErrorCode.UnexpectedEof)!;
        const position = { offset: query.length, line: 2, col: 5 };
        expect(error.range).toEqual({ start: position, end: position });
        expect(new SqlLanguageService().getDiagnostics(query)).toContainEqual(
            expect.objectContaining({
                range: {
                    startOffset: query.length,
                    endOffset: query.length,
                    startLine: 2,
                    startColumn: 5,
                    endLine: 2,
                    endColumn: 5,
                },
            }),
        );
    });

    it.each(['', 'SELECT', 'SELECT * FROM c WHERE'])('keeps EOF ranges within input bounds: %s', (query) => {
        const { errors } = parse(query);
        expect(errors.length).toBeGreaterThan(0);
        for (const error of errors) {
            expect(error.range.end.offset).toBeLessThanOrEqual(query.length);
        }
    });

    it('counts surrogate pairs and combining marks as UTF-16 units, with an exclusive AST end', () => {
        const query = 'SELECT VALUE "\uD83D\uDE00e\u0301"';
        const { ast, errors } = parse(query);
        expect(errors).toEqual([]);
        expect(ast!.range).toEqual({
            start: { offset: 0, line: 1, col: 1 },
            end: { offset: query.length, line: 1, col: query.length + 1 },
        });
    });

    it.each(['\n', '\r\n', '\r'])('keeps AST and lexer error positions consistent after %j', (newline) => {
        const query = `SELECT${newline}VALUE "\uD83D\uDE00"`;
        expect(parse(query).ast!.range!.end).toEqual({ offset: query.length, line: 2, col: 11 });
        const error = parse(`${query}#`).errors.find((e) => e.code === SqlErrorCode.UnexpectedToken)!;
        expect(error.range).toEqual({
            start: { offset: query.length, line: 2, col: 11 },
            end: { offset: query.length + 1, line: 2, col: 12 },
        });
    });

    it.each(['\n', '\r\n', '\r'])('maps multi-query diagnostics to document coordinates after %j', (newline) => {
        const prefix = `SELECT VALUE "\uD83D\uDE00";${newline}`;
        const query = `${prefix}SELECT * FROM`;
        const diagnostic = new SqlLanguageService({ multiQuery: true })
            .getDiagnostics(query)
            .find((d) => d.code === SqlErrorCode.UnexpectedEof)!;
        expect(diagnostic.range).toEqual({
            startOffset: query.length,
            endOffset: query.length,
            startLine: 2,
            startColumn: 14,
            endLine: 2,
            endColumn: 14,
        });
    });

    it('uses exclusive hover ends consistent with offsets after Unicode text and tabs', () => {
        const query = 'SELECT "\uD83D\uDE00",\tCOUNT(1)';
        const offset = query.indexOf('COUNT');
        expect(new SqlLanguageService().getHoverInfo(query, offset)?.range).toEqual({
            startOffset: offset,
            endOffset: offset + 5,
            startLine: 1,
            startColumn: offset + 1,
            endLine: 1,
            endColumn: offset + 6,
        });
    });

    it.each(['\n', '\r\n', '\r'])('uses matching formatting edit positions after %j', (newline) => {
        const query = `select${newline}value "\uD83D\uDE00"`;
        expect(new SqlLanguageService().getFormatEdits(query)[0].range).toEqual({
            startOffset: 0,
            endOffset: query.length,
            startLine: 1,
            startColumn: 1,
            endLine: 2,
            endColumn: 11,
        });
    });
});
