/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    parse,
    SqlLanguageService,
} from '@azure/cosmosdb-nosql-language-service';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const documentation = readFileSync(
    new URL('../diagnostics.md', import.meta.url),
    'utf8',
);
const examples = Array.from(
    documentation.matchAll(
        /^\|\s*`(?<code>[A-Z_]+)`\s*\|\s*(?:Error|Warning) \((?<severity>[12])\)\s*\|\s*`(?<query>[^`]+)`\s*\|\s*`(?<correction>[^`]+)`\s*\|$/gm,
    ),
    (match) => {
        const { code, severity, query, correction } = match.groups!;
        return { code, severity: Number(severity), query, correction };
    },
);

const parserCodes = ['UNEXPECTED_TOKEN', 'MISSING_KEYWORD', 'UNEXPECTED_EOF'];
const serviceCodes = [
    'POSSIBLE_TYPO',
    'BETWEEN_AMBIGUITY',
    'ORDER_BY_IN_SUBQUERY',
    'RANKED_ORDER_BY_SORT_ORDER',
];

describe('published diagnostic documentation', () => {
    it('provides an executable example for every documented diagnostic code', () => {
        expect(examples.map(({ code }) => code)).toEqual([
            ...parserCodes,
            ...serviceCodes,
        ]);
    });

    it.each(examples)(
        '$code is classified correctly by the standalone parser',
        ({ code, query }) => {
            const codes: string[] = parse(query).errors.map(
                (error) => error.code,
            );
            expect(codes.includes(code)).toBe(parserCodes.includes(code));
        },
    );

    describe.each([false, true])('multiQuery: %s', (multiQuery) => {
        it.each(examples)(
            '$code matches the example and clears after correction',
            ({ code, severity, query, correction }) => {
                const service = new SqlLanguageService({ multiQuery });
                const prefix = multiQuery ? 'SELECT VALUE 1;\n' : '';
                const diagnostics = service.getDiagnostics(prefix + query);
                expect(diagnostics).toContainEqual(
                    expect.objectContaining({ code, severity }),
                );
                expect(
                    diagnostics.every(
                        ({ range }) => range.startOffset >= prefix.length,
                    ),
                ).toBe(true);
                expect(service.getDiagnostics(prefix + correction)).toEqual([]);
            },
        );
    });
});
