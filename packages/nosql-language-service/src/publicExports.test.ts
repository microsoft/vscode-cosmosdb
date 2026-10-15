/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
    type CompletionItem,
    type CompletionItemKind,
    DiagnosticSeverity,
    getCompletions,
    type JSONSchema,
    parse,
    SqlErrorCode,
    SqlLanguageService,
    sqlToString,
} from './index.js';
import {
    DiagnosticSeverity as ServiceDiagnosticSeverity,
    SqlLanguageService as ServiceSqlLanguageService,
} from './services/index.js';

describe('public entry point contracts', () => {
    it('exports the same runtime severity enum from the root and services entry points', () => {
        expect(DiagnosticSeverity).toBe(ServiceDiagnosticSeverity);
        expect(DiagnosticSeverity).toMatchObject({
            Error: 1,
            Warning: 2,
            Information: 3,
            Hint: 4,
        });
    });

    it('supports filtering service diagnostics with the root severity export', () => {
        expect(SqlLanguageService).toBe(ServiceSqlLanguageService);
        const diagnostics = new SqlLanguageService().getDiagnostics('SELECT * FROM');
        expect(diagnostics.length).toBeGreaterThan(0);
        expect(diagnostics.some((diagnostic) => diagnostic.severity === DiagnosticSeverity.Error)).toBe(true);
    });

    it('exports error codes as runtime values for interpreting parse results', () => {
        expect(SqlErrorCode.UnexpectedEof).toBe('UNEXPECTED_EOF');
        expect(parse('SELECT * FROM').errors).toEqual(
            expect.arrayContaining([expect.objectContaining({ code: SqlErrorCode.UnexpectedEof })]),
        );
    });

    it('supports the documented core quickstart using only public exports', () => {
        const schema: JSONSchema = {
            type: 'object',
            properties: { age: { type: 'number' }, name: { type: 'string' } },
        };
        const query = 'SELECT * FROM c WHERE c.age > 21';
        const { ast, errors } = parse(query);
        expect(errors).toEqual([]);
        expect(ast).toBeDefined();
        expect(sqlToString(ast!)).toBe(query);
        expect(getCompletions({ query: 'SELECT c.', offset: 9, schema })).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ label: 'age', kind: 'field' }),
                expect.objectContaining({ label: 'name', kind: 'field' }),
            ]),
        );
    });

    it('includes parameter in the public completion kind contract', () => {
        expectTypeOf<CompletionItemKind>().toEqualTypeOf<
            'keyword' | 'field' | 'function' | 'snippet' | 'parameter' | 'alias'
        >();
        const item: CompletionItem = { label: '@name', kind: 'parameter' };
        expect(item.kind).toBe('parameter');
    });
});
