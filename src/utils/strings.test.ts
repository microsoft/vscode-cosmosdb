/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { leftPadIndex, toStringUniversal, truncateString } from './strings';

describe('strings', () => {
    describe('toStringUniversal', () => {
        it('should return "null" for null', () => {
            expect(toStringUniversal(null)).toBe('null');
        });

        it('should return "undefined" for undefined', () => {
            expect(toStringUniversal(undefined)).toBe('undefined');
        });

        it('should convert numbers to string', () => {
            expect(toStringUniversal(42)).toBe('42');
            expect(toStringUniversal(3.14)).toBe('3.14');
            expect(toStringUniversal(-0)).toBe('0');
            expect(toStringUniversal(NaN)).toBe('NaN');
            expect(toStringUniversal(Infinity)).toBe('Infinity');
        });

        it('should convert booleans to string', () => {
            expect(toStringUniversal(true)).toBe('true');
            expect(toStringUniversal(false)).toBe('false');
        });

        it('should return strings as-is', () => {
            expect(toStringUniversal('hello')).toBe('hello');
            expect(toStringUniversal('')).toBe('');
        });

        it('should use Error.message for Error objects', () => {
            expect(toStringUniversal(new Error('something broke'))).toBe('something broke');
        });

        it('should pretty-print plain objects', () => {
            const result = toStringUniversal({ a: 1, b: 'x' });
            expect(result).toBe(JSON.stringify({ a: 1, b: 'x' }, null, 2));
        });

        it('should pretty-print arrays', () => {
            const result = toStringUniversal([1, 2, 3]);
            expect(result).toBe(JSON.stringify([1, 2, 3], null, 2));
        });

        it('should handle nested objects', () => {
            const obj = { a: { b: { c: 42 } } };
            expect(toStringUniversal(obj)).toBe(JSON.stringify(obj, null, 2));
        });

        it('should fall back to Object.prototype.toString for circular references', () => {
            const circular: Record<string, unknown> = {};
            circular.self = circular;
            const result = toStringUniversal(circular);
            expect(result).toMatch(/\[object Object]/);
        });

        it('should return "{}" for a Map (JSON.stringify serialises it as {})', () => {
            // Map is JSON-serialisable as {} so JSON path wins
            expect(toStringUniversal(new Map([['k', 'v']]))).toBe('{}');
        });
    });

    describe('truncateString', () => {
        it('should return the original string when shorter than maxLength', () => {
            expect(truncateString('hello', 10)).toBe('hello');
        });

        it('should return the original string when equal to maxLength', () => {
            expect(truncateString('hello', 5)).toBe('hello');
        });

        it('should truncate and append suffix when longer than maxLength', () => {
            expect(truncateString('hello world', 8)).toBe('hello w…');
        });

        it('should use a custom suffix', () => {
            expect(truncateString('hello world', 8, '...')).toBe('hello...');
        });

        it('should return "" for an empty string', () => {
            expect(truncateString('', 10)).toBe('');
        });

        it('should handle maxLength equal to suffix length', () => {
            // Result should be just the suffix itself when there's no room for content
            expect(truncateString('hello', 1, '…')).toBe('…');
        });
    });

    describe('leftPadIndex', () => {
        it('should pad a single-digit index in a 10-item array', () => {
            expect(leftPadIndex(0, 10)).toBe('0');
            expect(leftPadIndex(9, 10)).toBe('9');
        });

        it('should pad indices in a 100-item array to 2 digits', () => {
            expect(leftPadIndex(0, 100)).toBe('00');
            expect(leftPadIndex(7, 100)).toBe('07');
            expect(leftPadIndex(99, 100)).toBe('99');
        });

        it('should pad indices in a 1000-item array to 3 digits', () => {
            expect(leftPadIndex(0, 1000)).toBe('000');
            expect(leftPadIndex(42, 1000)).toBe('042');
            expect(leftPadIndex(999, 1000)).toBe('999');
        });

        it('should accept an array and use its length', () => {
            const arr = Array.from({ length: 100 });
            expect(leftPadIndex(5, arr)).toBe('05');
        });

        it('should support a custom pad character', () => {
            expect(leftPadIndex(3, 100, ' ')).toBe(' 3');
        });

        it('should not pad when index already fills all digits', () => {
            expect(leftPadIndex(99, 100)).toBe('99');
        });
    });
});
