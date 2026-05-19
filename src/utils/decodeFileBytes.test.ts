/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeFileBytes } from './decodeFileBytes';

describe('decodeFileBytes', () => {
    it('decodes plain UTF-8 without BOM', () => {
        const bytes = new TextEncoder().encode('CREATE TABLE T1 (id INT);');
        const result = decodeFileBytes(bytes);
        expect(result.text).toBe('CREATE TABLE T1 (id INT);');
        expect(result.encoding).toBe('utf-8');
    });

    it('decodes UTF-8 with BOM and strips the BOM', () => {
        const body = new TextEncoder().encode('hello');
        const bytes = new Uint8Array(body.length + 3);
        bytes.set([0xef, 0xbb, 0xbf], 0);
        bytes.set(body, 3);
        const result = decodeFileBytes(bytes);
        expect(result.text).toBe('hello');
        expect(result.encoding).toBe('utf-8-bom');
    });

    it('decodes UTF-16 LE with BOM (SSMS export format)', () => {
        // "AB" in UTF-16 LE: 41 00 42 00 with FF FE BOM prefix
        const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
        const result = decodeFileBytes(bytes);
        expect(result.text).toBe('AB');
        expect(result.encoding).toBe('utf-16le');
    });

    it('decodes UTF-16 BE with BOM', () => {
        // "AB" in UTF-16 BE: 00 41 00 42 with FE FF BOM prefix
        const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]);
        const result = decodeFileBytes(bytes);
        expect(result.text).toBe('AB');
        expect(result.encoding).toBe('utf-16be');
    });

    it('handles empty input', () => {
        const result = decodeFileBytes(new Uint8Array(0));
        expect(result.text).toBe('');
        expect(result.encoding).toBe('utf-8');
    });

    it('handles UTF-16 LE schema content with multiline DDL', () => {
        const text = 'CREATE TABLE T (id INT);\nGO\n';
        const codeUnits: number[] = [0xff, 0xfe];
        for (const ch of text) {
            const code = ch.charCodeAt(0);
            codeUnits.push(code & 0xff, (code >> 8) & 0xff);
        }
        const bytes = new Uint8Array(codeUnits);
        const result = decodeFileBytes(bytes);
        expect(result.text).toBe(text);
        expect(result.encoding).toBe('utf-16le');
    });
});
