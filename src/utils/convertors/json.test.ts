/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { queryResultToJSON } from './json';
import { makeResult } from './testFixtures';

describe('queryResultToJSON', () => {
    it('returns an empty string for null', () => {
        expect(queryResultToJSON(null)).toBe('');
    });

    it('serializes all documents pretty-printed', () => {
        const result = makeResult({ documents: [{ a: 1 }, { b: 2 }] });
        expect(queryResultToJSON(result)).toBe(JSON.stringify([{ a: 1 }, { b: 2 }], null, 4));
    });

    it('serializes only the selected documents (by index)', () => {
        const result = makeResult({ documents: [{ a: 1 }, { b: 2 }, { c: 3 }] });
        expect(queryResultToJSON(result, [0, 2])).toBe(JSON.stringify([{ a: 1 }, { c: 3 }], null, 4));
    });

    it('returns "[]" when the selection matches nothing', () => {
        const result = makeResult({ documents: [{ a: 1 }] });
        expect(queryResultToJSON(result, [5])).toBe(JSON.stringify([], null, 4));
    });
});
