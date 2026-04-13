/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NOSQL_KEYWORDS } from './nosqlLanguageDefinitions';

describe('Phase 1: Trailing Space & Semicolon Auto-Formatting', () => {
    describe('Keyword trailing spaces', () => {
        const keywordsWithTrailingSpace = NOSQL_KEYWORDS.filter(
            (kw) =>
                kw.category === 'clause' ||
                kw.category === 'operator' ||
                kw.name === 'AS' ||
                kw.name === 'DISTINCT' ||
                kw.name === 'TOP' ||
                kw.name === 'VALUE',
        );

        const keywordsWithoutTrailingSpace = NOSQL_KEYWORDS.filter(
            (kw) => kw.name === 'ASC' || kw.name === 'DESC' || kw.category === 'constant',
        );

        it.each(keywordsWithTrailingSpace.map((kw) => [kw.name, kw.snippet]))(
            '%s snippet should end with a trailing space',
            (_name, snippet) => {
                expect(snippet).toMatch(/ $/);
            },
        );

        it.each(keywordsWithoutTrailingSpace.map((kw) => [kw.name, kw.snippet]))(
            '%s snippet should NOT end with a trailing space',
            (_name, snippet) => {
                expect(snippet).not.toMatch(/ $/);
            },
        );

        it('all keyword snippets should start with the keyword name (trimmed)', () => {
            for (const kw of NOSQL_KEYWORDS) {
                expect(kw.snippet.trimEnd()).toBe(kw.name);
            }
        });
    });
});
