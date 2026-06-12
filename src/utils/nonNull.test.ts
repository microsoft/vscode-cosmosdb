/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { nonNullOrEmptyValue, nonNullProp, nonNullValue } from './nonNull';

describe('nonNullValue', () => {
    it('returns the value when it is defined', () => {
        expect(nonNullValue(0)).toBe(0);
        expect(nonNullValue('')).toBe('');
        expect(nonNullValue(false)).toBe(false);
        expect(nonNullValue({ a: 1 })).toEqual({ a: 1 });
    });

    it('throws when the value is undefined', () => {
        expect(() => nonNullValue(undefined)).toThrow('Internal error');
    });

    it('throws when the value is null', () => {
        expect(() => nonNullValue(null)).toThrow('Internal error');
    });

    it('includes the property name / message in the error', () => {
        expect(() => nonNullValue(undefined, 'myProp')).toThrow('myProp');
    });
});

describe('nonNullProp', () => {
    it('returns the property value when present', () => {
        const source = { name: 'cosmos', count: 0 };
        expect(nonNullProp(source, 'name')).toBe('cosmos');
        expect(nonNullProp(source, 'count')).toBe(0);
    });

    it('throws and reports the property name when the property is undefined', () => {
        const source: { name?: string } = {};
        expect(() => nonNullProp(source, 'name')).toThrow('name');
    });

    it('appends an extra message to the property name in the error', () => {
        const source: { name?: string } = {};
        expect(() => nonNullProp(source, 'name', 'must be set')).toThrow('name, must be set');
    });
});

describe('nonNullOrEmptyValue', () => {
    it('returns the string when it is non-empty', () => {
        expect(nonNullOrEmptyValue('hello')).toBe('hello');
    });

    it('throws when the value is an empty string', () => {
        expect(() => nonNullOrEmptyValue('')).toThrow('Internal error');
    });

    it('throws when the value is undefined', () => {
        expect(() => nonNullOrEmptyValue(undefined)).toThrow('Internal error');
    });

    it('includes the property name / message in the error', () => {
        expect(() => nonNullOrEmptyValue('', 'requiredField')).toThrow('requiredField');
    });
});
