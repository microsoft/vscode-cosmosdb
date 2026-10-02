/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as standaloneBson from 'bson';
import * as mongodb from 'mongodb';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type JSONSchema } from '../index.js';
import { inferBsonType, SchemaAnalyzer, valueToDisplayString, type BSONType } from './index.js';

const require = createRequire(import.meta.url);
// Load a real second BSON copy, without relying on npm deduplication or the test runner's ESM interop.
const foreignBson = runInNewContext(`${readFileSync(require.resolve('bson'), 'utf8')}\nexports;`, {
    exports: {},
    require,
    Buffer,
}) as typeof standaloneBson;

const browserBson = runInNewContext(
    `${readFileSync(join(dirname(require.resolve('bson')), 'bson.bundle.js'), 'utf8')}\nBSON;`,
    { TextEncoder, TextDecoder, atob, btoa },
) as typeof standaloneBson;

function samples(bson: typeof standaloneBson.BSON): { name: string; value: unknown; type: BSONType }[] {
    const legacyUuid = new bson.Binary(new Uint8Array(16), 3);
    const referenceWithId = (id: unknown): unknown => {
        const document: Record<string, unknown> = bson.deserialize(bson.serialize({ ref: { $ref: 'c', $id: id } }));
        return document.ref;
    };
    return [
        { name: 'ObjectId', value: new bson.ObjectId('507f1f77bcf86cd799439011'), type: 'objectid' },
        { name: 'Int32', value: new bson.Int32(42), type: 'int32' },
        { name: 'Double', value: new bson.Double(1.25), type: 'double' },
        { name: 'Long', value: bson.Long.fromNumber(123), type: 'long' },
        { name: 'Timestamp', value: new bson.Timestamp({ t: 1, i: 2 }), type: 'timestamp' },
        { name: 'Decimal128', value: bson.Decimal128.fromString('1.25'), type: 'decimal128' },
        { name: 'Binary', value: new bson.Binary(new Uint8Array([1, 2, 3])), type: 'binary' },
        { name: 'empty Binary', value: new bson.Binary(), type: 'binary' },
        { name: 'UUID', value: new bson.UUID('00112233-4455-6677-8899-aabbccddeeff'), type: 'uuid' },
        { name: 'legacy UUID', value: legacyUuid, type: 'uuid-legacy' },
        { name: 'plain UUID Binary', value: new bson.Binary(new Uint8Array(16), 4), type: 'uuid' },
        { name: 'BSONRegExp', value: new bson.BSONRegExp('abc', 'i'), type: 'regexp' },
        { name: 'BSONSymbol', value: new bson.BSONSymbol('s'), type: 'symbol' },
        { name: 'Code', value: new bson.Code('return 1;'), type: 'code' },
        { name: 'scoped Code', value: new bson.Code('return x;', { x: 1 }), type: 'codewithscope' },
        { name: 'DBRef', value: new bson.DBRef('c', new bson.ObjectId('507f1f77bcf86cd799439011')), type: 'dbref' },
        { name: 'string DBRef', value: referenceWithId('customer-123'), type: 'dbref' },
        { name: 'numeric DBRef', value: referenceWithId(123), type: 'dbref' },
        { name: 'null reference document', value: referenceWithId(null), type: 'object' },
        { name: 'document DBRef', value: referenceWithId({ key: 1 }), type: 'dbref' },
        { name: 'MinKey', value: new bson.MinKey(), type: 'minkey' },
        { name: 'MaxKey', value: new bson.MaxKey(), type: 'maxkey' },
    ];
}

describe('BSON values from independent module copies', () => {
    const local = samples(standaloneBson);
    const foreign = [
        ...samples(foreignBson).map((sample, index) => ({ ...sample, source: 'VM', local: local[index].value })),
        ...samples(mongodb.BSON).map((sample, index) => ({ ...sample, source: 'driver', local: local[index].value })),
    ];

    it('uses independent BSON constructors', () => {
        expect(foreignBson.ObjectId).not.toBe(mongodb.ObjectId);
        expect(foreignBson.Binary).not.toBe(mongodb.Binary);
        expect(foreignBson.ObjectId).not.toBe(standaloneBson.ObjectId);
        expect(foreignBson.Binary).not.toBe(standaloneBson.Binary);
    });

    it.each(foreign)(
        'preserves inference, display and schema for $source $name',
        ({ value, type, local: localValue }) => {
            expect(inferBsonType(value)).toBe(type);
            expect(valueToDisplayString(value, type)).toBe(valueToDisplayString(localValue, type));
            const schema = (field: unknown) =>
                SchemaAnalyzer.fromDocument({
                    _id: new mongodb.ObjectId('507f1f77bcf86cd799439011'),
                    field,
                }).getSchema();
            expect(schema(value)).toEqual(schema(localValue));
        },
    );

    it('merges binary statistics across copies and Buffer observations', () => {
        const analyzer = SchemaAnalyzer.fromDocuments([
            { _id: new mongodb.ObjectId(), value: new foreignBson.Binary(Buffer.alloc(3)) },
            { _id: new mongodb.ObjectId(), value: new mongodb.Binary(Buffer.alloc(5)) },
            { _id: new mongodb.ObjectId(), value: Buffer.alloc(0) },
        ]);
        const field = analyzer.getSchema().properties!['value'] as JSONSchema;
        expect(field.anyOf).toHaveLength(1);
        expect(field.anyOf![0]).toMatchObject({
            'x-bsonType': 'binary',
            'x-minLength': 0,
            'x-maxLength': 5,
            'x-typeOccurrence': 3,
        });
    });

    it('recognizes BSON values without relying on their constructor property', () => {
        const value = new foreignBson.ObjectId('507f1f77bcf86cd799439011');
        Object.defineProperty(value, 'constructor', { value: undefined });
        expect(inferBsonType(value)).toBe('objectid');
        expect(valueToDisplayString(value, inferBsonType(value))).toBe('507f1f77bcf86cd799439011');
    });

    it('does not invoke BSON serialization or binary length methods during inference', () => {
        const value = new foreignBson.Binary(Buffer.alloc(3));
        const fail = () => {
            throw new Error('Inference must not invoke value methods');
        };
        Object.defineProperty(value, 'length', { value: fail });
        Object.defineProperty(value, 'toExtendedJSON', { value: fail });
        expect(inferBsonType(value)).toBe('binary');
    });

    it.each([-1, 4, 1.5, NaN, Infinity, '3'])('rejects an invalid binary byte length: %s', (length) => {
        const value = new foreignBson.Binary(Buffer.alloc(3));
        Object.defineProperty(value, 'length', { value: () => length });
        expect(() => valueToDisplayString(value, 'binary')).toThrow(TypeError);
        expect(() => SchemaAnalyzer.fromDocument({ _id: new mongodb.ObjectId(), value })).toThrow(TypeError);
    });
});

describe('native values from another JavaScript realm', () => {
    const values = runInNewContext(`({
        date: new Date('2024-01-02T03:04:05.000Z'),
        regexp: /abc/gi,
        map: new Map([['x', 1]]),
        array: [1, 2]
    })`) as { date: Date; regexp: RegExp; map: Map<string, number>; array: number[] };

    it.each([
        { value: values.date, type: 'date', display: '2024-01-02T03:04:05.000Z' },
        { value: values.regexp, type: 'regexp', display: 'abc gi' },
        { value: values.map, type: 'map', display: '{}' },
        { value: values.array, type: 'array', display: '[1,2]' },
    ] as const)('recognizes and formats $type', ({ value, type, display }) => {
        expect(inferBsonType(value)).toBe(type);
        expect(valueToDisplayString(value, inferBsonType(value))).toBe(display);
    });
});

describe('binary values without a global Buffer', () => {
    beforeEach(() => vi.stubGlobal('Buffer', undefined));
    afterEach(() => vi.unstubAllGlobals());

    it.each([
        { name: 'empty Uint8Array', value: new Uint8Array(), length: 0 },
        { name: 'Uint8Array view', value: new Uint8Array(16).subarray(4, 7), length: 3 },
        { name: 'Buffer view', value: Buffer.alloc(16).subarray(4, 7), length: 3 },
        { name: 'foreign Uint8Array', value: runInNewContext('new Uint8Array([1, 2])'), length: 2 },
    ])('infers, formats and aggregates $name', ({ value, length }) => {
        expect(inferBsonType(value)).toBe('binary');
        expect(valueToDisplayString(value, 'binary')).toBe(`Binary[${length}]`);
        const analyzer = SchemaAnalyzer.fromDocuments([
            { value },
            { value: new browserBson.Binary(new Uint8Array(5)) },
        ]);
        const field = analyzer.getSchema().properties!['value'] as JSONSchema;
        expect(field.anyOf).toHaveLength(1);
        expect(field.anyOf![0]).toMatchObject({
            'x-bsonType': 'binary',
            'x-minLength': length,
            'x-maxLength': 5,
            'x-typeOccurrence': 2,
        });
    });

    it.each([
        new Uint16Array([256]),
        new Int16Array([1]),
        new Uint32Array([1]),
        new Float32Array([1]),
        new Int8Array([1]),
        new Uint8ClampedArray([1]),
        new DataView(new ArrayBuffer(2)),
        new ArrayBuffer(2),
        runInNewContext('new Uint16Array([256])'),
        { [Symbol.toStringTag]: 'Uint8Array', length: 2, byteLength: 2 },
    ])('does not interpret other representations as bytes: %j', (value) => {
        expect(inferBsonType(value)).toBe('object');
        expect(() => valueToDisplayString(value, 'binary')).toThrow(TypeError);
    });

    it.each(samples(browserBson))('supports the browser BSON build: $name', ({ value, type }) => {
        expect(inferBsonType(value)).toBe(type);
        expect(typeof valueToDisplayString(value, type)).toBe('string');
        const analyzer = SchemaAnalyzer.fromDocument({ value });
        const field = analyzer.getSchema().properties!['value'] as JSONSchema;
        expect(field.anyOf![0]).toMatchObject({ 'x-bsonType': type });
        expect(analyzer.clone().getSchema()).toEqual(analyzer.getSchema());
        expect(analyzer.getKnownFields().length).toBeGreaterThan(0);
    });

    it('uses Uint8Array storage in browser BSON Binary', () => {
        const binary = new browserBson.Binary(new Uint8Array([1, 2]));
        expect(Object.prototype.toString.call(binary.buffer)).toBe('[object Uint8Array]');
        expect(binary.buffer.byteLength).toBe(2);
        const empty = new browserBson.Binary();
        expect(valueToDisplayString(empty, 'binary')).toBe('Binary[0]');
        empty.put(1);
        expect(valueToDisplayString(empty, 'binary')).toBe('Binary[1]');
    });
});

describe('BSON-looking ordinary objects', () => {
    it.each([
        'ObjectId',
        'Int32',
        'Double',
        'Long',
        'Timestamp',
        'Decimal128',
        'Binary',
        'BSONRegExp',
        'BSONSymbol',
        'Code',
        'DBRef',
        'MinKey',
        'MaxKey',
        'Unknown',
    ])('does not recognize the %s tag alone', (_bsontype) => {
        expect(inferBsonType({ _bsontype })).toBe('object');
    });

    it.each([
        { _bsontype: 'ObjectId', toHexString: 'not a method' },
        { _bsontype: 'Int32', value: '42' },
        { _bsontype: 'Double', value: '1.25' },
        { _bsontype: 'Long', low: 1, high: '0', unsigned: false },
        { _bsontype: 'Timestamp', low: 1, high: 0 },
        { _bsontype: 'Decimal128', bytes: [1, 2] },
        { _bsontype: 'Binary', buffer: Buffer.alloc(3), position: 3, sub_type: 0, length: 3 },
        { _bsontype: 'Binary', buffer: Buffer.alloc(3), position: 4, sub_type: 0, length: () => 4 },
        { _bsontype: 'BSONRegExp', pattern: 'abc', options: 123 },
        { _bsontype: 'BSONSymbol', value: 123 },
        { _bsontype: 'Code', code: 123 },
        { _bsontype: 'DBRef', collection: 'c' },
    ])('rejects an incompatible $_bsontype shape', (value) => {
        expect(inferBsonType({ ...value, toExtendedJSON: () => ({}) })).toBe('object');
    });

    it.each(['Date', 'RegExp', 'Map'])('does not recognize a %s toStringTag alone', (tag) => {
        expect(inferBsonType({ [Symbol.toStringTag]: tag })).toBe('object');
    });

    it('does not read an ordinary document tag during inference', () => {
        const readTag = vi.fn(() => {
            throw new Error('Document data must not be read during inference');
        });
        const value = Object.defineProperty({}, '_bsontype', { get: readTag });
        expect(inferBsonType(value)).toBe('object');
        expect(readTag).not.toHaveBeenCalled();
    });

    it('propagates errors from wrapper property access instead of hiding them as unknown types', () => {
        const failure = new Error('Unreadable BSON tag');
        class UnreadableValue {
            get _bsontype(): string {
                throw failure;
            }
        }
        const value = new UnreadableValue();
        expect(() => inferBsonType(value)).toThrow(failure);
    });
});
