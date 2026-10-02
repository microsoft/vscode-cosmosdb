/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Binary, BSONRegExp, BSONSymbol, Code, ObjectId, Timestamp, UUID } from 'bson';
import { describe, expect, it } from 'vitest';
import { flatDocument } from './fixtures.js';
import { inferBsonType, valueToDisplayString } from './index.js';

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

    it('formats invalid dates explicitly', () => {
        expect(valueToDisplayString(new Date(NaN), 'date')).toBe('Invalid Date');
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

    it.each([Buffer.alloc(0), Buffer.from([1, 2, 3, 4])])('formats an inferred Buffer: %j', (value) => {
        expect(inferBsonType(value)).toBe('binary');
        expect(valueToDisplayString(value, inferBsonType(value))).toBe(`Binary[${value.length}]`);
    });

    it.each([/^abc$/gim, /abc/, new RegExp('')])('formats an inferred JavaScript regexp: %s', (value) => {
        expect(inferBsonType(value)).toBe('regexp');
        expect(valueToDisplayString(value, inferBsonType(value))).toBe(`${value.source} ${value.flags}`);
    });

    it('formats inferred undefined as a string', () => {
        expect(inferBsonType(undefined)).toBe('undefined');
        expect(valueToDisplayString(undefined, inferBsonType(undefined))).toBe('undefined');
    });

    it.each([new BSONRegExp('^abc$', 'im'), new BSONRegExp('', '')])('formats an inferred BSON regexp: %j', (value) => {
        expect(inferBsonType(value)).toBe('regexp');
        expect(valueToDisplayString(value, inferBsonType(value))).toBe(`${value.pattern} ${value.options}`);
    });

    it.each([Symbol('s'), 1n, () => 1])('formats unsupported primitives and functions explicitly: %s', (value) => {
        expect(inferBsonType(value)).toBe('_unknown_');
        expect(valueToDisplayString(value, inferBsonType(value))).toBe('Unknown');
    });

    it('formats the used Binary length rather than its buffer capacity', () => {
        const value = new Binary();
        expect(valueToDisplayString(value, inferBsonType(value))).toBe('Binary[0]');
        value.put(1);
        expect(valueToDisplayString(value, inferBsonType(value))).toBe('Binary[1]');
    });

    it('formats only the bytes in a Buffer view', () => {
        const value = Buffer.alloc(16).subarray(4, 7);
        expect(valueToDisplayString(value, inferBsonType(value))).toBe('Binary[3]');
    });

    it('stringifies BSON symbols', () => {
        const value = new BSONSymbol('s');
        expect(inferBsonType(value)).toBe('symbol');
        expect(valueToDisplayString(value, 'symbol')).toBe('s');
    });

    it.each([3, 4])('formats subtype %s from raw bytes without depending on UUID methods', (subtype) => {
        const uuid = new UUID('00112233-4455-6677-8899-aabbccddeeff');
        const binary = new Binary(uuid.buffer, subtype);
        expect(valueToDisplayString(binary, inferBsonType(binary))).toBe('"00112233-4455-6677-8899-aabbccddeeff"');
        expect(valueToDisplayString(binary, inferBsonType(binary))).toBe(valueToDisplayString(uuid, 'uuid'));
    });

    it('formats only the used UUID bytes within a larger backing allocation', () => {
        const uuid = new UUID('00112233-4455-6677-8899-aabbccddeeff');
        const value = new Binary(new Uint8Array(32).fill(255), 4);
        value.buffer.set(uuid.buffer);
        value.position = 16;
        expect(valueToDisplayString(value, inferBsonType(value))).toBe('"00112233-4455-6677-8899-aabbccddeeff"');
    });

    it.each([new Binary(new Uint8Array(16), 0), new Binary(new Uint8Array(15), 3), new Uint8Array(16)])(
        'rejects incompatible values explicitly formatted as UUIDs',
        (value) => {
            expect(() => valueToDisplayString(value, 'uuid')).toThrow(TypeError);
            expect(() => valueToDisplayString(value, 'uuid-legacy')).toThrow(TypeError);
        },
    );

    it('rejects a UUID whose length method disagrees with its position', () => {
        const value = new Binary(new Uint8Array(16), 4);
        Object.defineProperty(value, 'length', { value: () => 15 });
        expect(inferBsonType(value)).toBe('uuid');
        expect(() => valueToDisplayString(value, 'uuid')).toThrow(TypeError);
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
    });

    it('does not serialize unknown values or expose their internals', () => {
        const value = {
            internal: 1,
            toJSON() {
                throw new Error('Unknown values must not be serialized');
            },
        };
        expect(valueToDisplayString(value, '_unknown_')).toBe('Unknown');
    });

    it.each([
        ...Object.entries(flatDocument),
        ['array', [1, 'two']],
        ['object', { a: 1 }],
        ['map', new Map([['a', 1]])],
        ['scoped code', new Code('return x;', { x: 1 })],
    ])('returns a string for inferred %s', (_name, value) => {
        expect(typeof valueToDisplayString(value, inferBsonType(value))).toBe('string');
    });

    it('rejects unsupported JSON serialization for ordinary objects', () => {
        const value = { toJSON: () => undefined };
        expect(() => valueToDisplayString(value, inferBsonType(value))).toThrow(TypeError);
    });

    it('propagates circular JSON serialization errors', () => {
        const value: Record<string, unknown> = {};
        value['self'] = value;
        expect(() => valueToDisplayString(value, inferBsonType(value))).toThrow(TypeError);
    });
});
