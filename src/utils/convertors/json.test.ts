/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createQueryResultJsonPreview,
    getQueryResultJsonByteLength,
    getQueryResultJsonChunks,
    queryResultToJSON,
} from './json';
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

    it('measures the exact UTF-8 byte length without constructing the complete array string', () => {
        const result = makeResult({ documents: [{ text: 'ASCII' }, { text: 'Příliš žluťoučký kůň' }] });
        const json = queryResultToJSON(result);

        expect(getQueryResultJsonByteLength(result)).toBe(new TextEncoder().encode(json).byteLength);
    });

    it('creates a byte-bounded UTF-8 preview', () => {
        const result = makeResult({ documents: [{ text: '😀'.repeat(20) }, { value: 2 }] });
        const maximumBytes = 40;
        const preview = createQueryResultJsonPreview(result, maximumBytes);

        expect(preview.isTruncated).toBe(true);
        expect(new TextEncoder().encode(preview.json).byteLength).toBeLessThanOrEqual(maximumBytes);
        expect(preview.json).not.toContain('\uFFFD');
    });

    it('returns the complete JSON when it fits within the preview budget', () => {
        const result = makeResult({ documents: [{ value: 1 }] });
        const json = queryResultToJSON(result);

        expect(createQueryResultJsonPreview(result, new TextEncoder().encode(json).byteLength)).toEqual({
            json,
            isTruncated: false,
        });
    });

    it('streams the complete JSON in bounded chunks without splitting surrogate pairs', () => {
        const result = makeResult({ documents: [{ text: '😀'.repeat(40) }, { value: 2 }] });
        const chunks = [...getQueryResultJsonChunks(result, Number.POSITIVE_INFINITY, 17)];

        expect(chunks.join('')).toBe(queryResultToJSON(result));
        expect(chunks.every((chunk) => chunk.length <= 17)).toBe(true);
        expect(chunks.every((chunk) => !/[\uD800-\uDBFF]$/.test(chunk))).toBe(true);
        expect(chunks.every((chunk) => !/^[\uDC00-\uDFFF]/.test(chunk))).toBe(true);
    });

    it('streams a UTF-8 byte-bounded prefix', () => {
        const result = makeResult({ documents: [{ text: '😀'.repeat(40) }, { value: 2 }] });
        const maximumBytes = 70;
        const json = [...getQueryResultJsonChunks(result, maximumBytes, 17)].join('');

        expect(new TextEncoder().encode(json).byteLength).toBeLessThanOrEqual(maximumBytes);
        expect(json).not.toContain('\uFFFD');
    });

    it('can stream surrogate pairs with a one-character target chunk size', () => {
        const result = makeResult({ documents: [{ text: '😀' }] });

        expect([...getQueryResultJsonChunks(result, Number.POSITIVE_INFINITY, 1)].join('')).toBe(
            queryResultToJSON(result),
        );
    });
});
