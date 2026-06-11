/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getErrorMessage } from './getErrorMessage';

describe('getErrorMessage', () => {
    it('returns the message of a real Error', () => {
        expect(getErrorMessage(new Error('boom'))).toBe('boom');
    });

    it('returns the message of any object with a string message property', () => {
        expect(getErrorMessage({ message: 'custom failure' })).toBe('custom failure');
    });

    it('JSON-stringifies plain objects without a string message', () => {
        expect(getErrorMessage({ code: 42 })).toBe('{"code":42}');
        // A numeric `message` is not a string, so the object is stringified.
        expect(getErrorMessage({ message: 123 })).toBe('{"message":123}');
    });

    it('JSON-stringifies primitive values', () => {
        expect(getErrorMessage('just a string')).toBe('"just a string"');
        expect(getErrorMessage(404)).toBe('404');
        expect(getErrorMessage(null)).toBe('null');
    });

    it('falls back to String() when JSON.stringify throws (circular reference)', () => {
        const circular: Record<string, unknown> = {};
        circular.self = circular;

        // JSON.stringify throws on the cycle → String(circular) === '[object Object]'.
        expect(getErrorMessage(circular)).toBe('[object Object]');
    });

    it('returns an empty string for undefined (Error("") message)', () => {
        // JSON.stringify(undefined) is the value `undefined`; new Error(undefined).message === ''.
        expect(getErrorMessage(undefined)).toBe('');
    });
});
