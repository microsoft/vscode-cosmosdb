/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { decodeFileBytes } from './decodeFileBytes';

describe('decodeFileBytes', () => {
    it('decodes plain UTF-8 without BOM', () => {
        const bytes = new TextEncoder().encode('CREATE TABLE T1 (id INT);');
        expect(decodeFileBytes(bytes)).toBe('CREATE TABLE T1 (id INT);');
    });

    it('decodes UTF-8 with BOM and strips the BOM', () => {
        const body = new TextEncoder().encode('hello');
        const bytes = new Uint8Array(body.length + 3);
        bytes.set([0xef, 0xbb, 0xbf], 0);
        bytes.set(body, 3);
        expect(decodeFileBytes(bytes)).toBe('hello');
    });

    it('decodes UTF-16 LE with BOM (SSMS export format)', () => {
        // "AB" in UTF-16 LE: 41 00 42 00 with FF FE BOM prefix
        const bytes = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00]);
        expect(decodeFileBytes(bytes)).toBe('AB');
    });

    it('decodes UTF-16 BE with BOM', () => {
        // "AB" in UTF-16 BE: 00 41 00 42 with FE FF BOM prefix
        const bytes = new Uint8Array([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]);
        expect(decodeFileBytes(bytes)).toBe('AB');
    });

    it('handles empty input', () => {
        expect(decodeFileBytes(new Uint8Array(0))).toBe('');
    });

    it('handles UTF-16 LE schema content with multiline DDL', () => {
        const text = 'CREATE TABLE T (id INT);\nGO\n';
        const codeUnits: number[] = [0xff, 0xfe];
        for (const ch of text) {
            const code = ch.charCodeAt(0);
            codeUnits.push(code & 0xff, (code >> 8) & 0xff);
        }
        const bytes = new Uint8Array(codeUnits);
        expect(decodeFileBytes(bytes)).toBe(text);
    });
});
