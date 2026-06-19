/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Binary, BSONRegExp, ObjectId, Timestamp } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { valueToDisplayString } from './ValueFormatters.js';

describe('valueToDisplayString', () => {
    it('returns strings unchanged', () => {
        expect(valueToDisplayString('hello', 'string')).toBe('hello');
    });

    it('stringifies numeric types', () => {
        expect(valueToDisplayString(42, 'number')).toBe('42');
        expect(valueToDisplayString(7, 'int32')).toBe('7');
        expect(valueToDisplayString(3.14, 'double')).toBe('3.14');
        expect(valueToDisplayString(100, 'decimal128')).toBe('100');
        expect(valueToDisplayString(9000, 'long')).toBe('9000');
    });

    it('stringifies booleans', () => {
        expect(valueToDisplayString(true, 'boolean')).toBe('true');
        expect(valueToDisplayString(false, 'boolean')).toBe('false');
    });

    it('formats dates as ISO strings', () => {
        const date = new Date('2024-01-02T03:04:05.000Z');
        expect(valueToDisplayString(date, 'date')).toBe('2024-01-02T03:04:05.000Z');
    });

    it('formats ObjectId as a hex string', () => {
        const oid = new ObjectId('507f1f77bcf86cd799439011');
        expect(valueToDisplayString(oid, 'objectid')).toBe('507f1f77bcf86cd799439011');
    });

    it('returns "null" for null', () => {
        expect(valueToDisplayString(null, 'null')).toBe('null');
    });

    it('formats a BSON regexp as "pattern options"', () => {
        expect(valueToDisplayString(new BSONRegExp('^abc$', 'i'), 'regexp')).toBe('^abc$ i');
    });

    it('formats binary values with their length', () => {
        const binary = new Binary(Buffer.from([1, 2, 3, 4]));
        expect(valueToDisplayString(binary, 'binary')).toBe('Binary[4]');
    });

    it('stringifies symbols', () => {
        expect(valueToDisplayString(Symbol('s'), 'symbol')).toBe('Symbol(s)');
    });

    it('stringifies timestamps via toString', () => {
        const ts = new Timestamp({ t: 1, i: 2 });
        expect(valueToDisplayString(ts, 'timestamp')).toBe(ts.toString());
    });

    it('returns sentinel strings for MinKey / MaxKey', () => {
        expect(valueToDisplayString({}, 'minkey')).toBe('MinKey');
        expect(valueToDisplayString({}, 'maxkey')).toBe('MaxKey');
    });

    it('JSON-stringifies code and codewithscope', () => {
        expect(valueToDisplayString({ code: 'x=1' }, 'code')).toBe('{"code":"x=1"}');
        expect(valueToDisplayString({ code: 'y=2' }, 'codewithscope')).toBe('{"code":"y=2"}');
    });

    it('JSON-stringifies arrays, objects and other fallthrough types', () => {
        expect(valueToDisplayString([1, 2], 'array')).toBe('[1,2]');
        expect(valueToDisplayString({ a: 1 }, 'object')).toBe('{"a":1}');
        expect(valueToDisplayString({ k: 'v' }, 'map')).toBe('{"k":"v"}');
        expect(valueToDisplayString({ $ref: 'c' }, 'dbref')).toBe('{"$ref":"c"}');
        expect(valueToDisplayString({ x: 1 }, '_unknown_')).toBe('{"x":1}');
    });
});
