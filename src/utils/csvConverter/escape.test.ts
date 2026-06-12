/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { escapeCsvValue } from './escape';

describe('escapeCsvValue', () => {
    it('wraps a plain value in double quotes', () => {
        expect(escapeCsvValue('abc')).toBe('"abc"');
    });

    it('doubles embedded double-quotes (RFC 4180)', () => {
        expect(escapeCsvValue('a"b')).toBe('"a""b"');
    });

    it('keeps separators and newlines inside the quoted field', () => {
        expect(escapeCsvValue('a,b;c\nd')).toBe('"a,b;c\nd"');
    });

    it('handles the empty string', () => {
        expect(escapeCsvValue('')).toBe('""');
    });
});
