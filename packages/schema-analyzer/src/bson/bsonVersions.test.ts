/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as currentBson from 'bson';
import * as bson4 from 'bson-v4';
import * as bson55 from 'bson-v5-5';
import * as bson60 from 'bson-v6-0';
import * as bson610 from 'bson-v6-10';
import * as bson70 from 'bson-v7-0';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { type JSONSchema } from '../index.js';
import { inferBsonType, SchemaAnalyzer, valueToDisplayString, type BSONType } from './index.js';

interface BinaryFixture {
    buffer: Uint8Array;
    position: number;
    put(byte: number): unknown;
}

// Only the fixture-building API is shared: full BSON declarations differ between major versions.
interface BsonFixtureModule {
    ObjectId: new (hex: string) => object;
    Int32: new (value: number) => object;
    Double: new (value: number) => object;
    Long: { fromNumber(value: number): object };
    Timestamp: new (value: { t: number; i: number }) => object;
    Decimal128: { fromString(value: string): object };
    Binary: new (bytes?: Uint8Array, subtype?: number) => BinaryFixture;
    UUID: new (hex: string) => object;
    BSONRegExp: new (pattern: string, options: string) => object;
    BSONSymbol: new (value: string) => object;
    Code: new (code: string, scope?: Record<string, unknown>) => object;
    MinKey: new () => object;
    MaxKey: new () => object;
    serialize(document: Record<string, unknown>): Uint8Array;
    deserialize(
        bytes: Uint8Array,
        options?: { promoteValues?: boolean; bsonRegExp?: boolean },
    ): Record<string, unknown>;
}

interface Sample {
    name: string;
    tag: string;
    type: BSONType;
    value: unknown;
    display: string;
}

const require = createRequire(import.meta.url);
// BSON 5.0.0 does not export declarations under NodeNext; load its real ESM build with the narrow fixture API.
const bson50: BsonFixtureModule = await import(
    pathToFileURL(join(dirname(require.resolve('bson-v5-0')), 'bson.mjs')).href
);
const versionMarker = Symbol.for('@@mdb.bson.version');
const objectId = '507f1f77bcf86cd799439011';
const uuid = '00112233-4455-4677-8899-aabbccddeeff';
const uuidBytes = Uint8Array.from(Buffer.from(uuid.replaceAll('-', ''), 'hex'));
const preserveWrappers = { promoteValues: false, bsonRegExp: true };
const versions = [
    { name: '5.0.0', alias: 'bson-v5-0', major: 5, bson: bson50 },
    { name: '5.5.1', alias: 'bson-v5-5', major: 5, bson: bson55 },
    { name: '6.0.0', alias: 'bson-v6-0', major: 6, bson: bson60 },
    { name: '6.10.4', alias: 'bson-v6-10', major: 6, bson: bson610 },
    { name: '7.0.0', alias: 'bson-v7-0', major: 7, bson: bson70 },
    { name: 'current 7.x', alias: 'bson', major: 7, bson: currentBson },
] satisfies { name: string; alias: string; major: number; bson: BsonFixtureModule }[];

function roundTrip(bson: BsonFixtureModule, value: unknown): unknown {
    return bson.deserialize(bson.serialize({ value }), preserveWrappers).value;
}

function samples(bson: BsonFixtureModule): Sample[] {
    // Decoding a reference document constructs a real DBRef while accepting non-ObjectId identifiers too.
    const reference = roundTrip(bson, {
        $ref: 'collection',
        $id: new bson.ObjectId(objectId),
        $db: 'database',
    });
    return [
        { name: 'ObjectId', tag: 'ObjectId', type: 'objectid', value: new bson.ObjectId(objectId), display: objectId },
        { name: 'Int32', tag: 'Int32', type: 'int32', value: new bson.Int32(42), display: '42' },
        { name: 'Double', tag: 'Double', type: 'double', value: new bson.Double(1.25), display: '1.25' },
        { name: 'Long', tag: 'Long', type: 'long', value: bson.Long.fromNumber(123), display: '123' },
        {
            name: 'Timestamp',
            tag: 'Timestamp',
            type: 'timestamp',
            value: new bson.Timestamp({ t: 1, i: 2 }),
            display: '4294967298',
        },
        {
            name: 'Decimal128',
            tag: 'Decimal128',
            type: 'decimal128',
            value: bson.Decimal128.fromString('1.25'),
            display: '1.25',
        },
        {
            name: 'Binary',
            tag: 'Binary',
            type: 'binary',
            value: new bson.Binary(new Uint8Array([1, 2, 3]), 0),
            display: 'Binary[3]',
        },
        { name: 'empty Binary', tag: 'Binary', type: 'binary', value: new bson.Binary(), display: 'Binary[0]' },
        { name: 'UUID', tag: 'Binary', type: 'uuid', value: new bson.UUID(uuid), display: JSON.stringify(uuid) },
        {
            name: 'UUID Binary',
            tag: 'Binary',
            type: 'uuid',
            value: new bson.Binary(uuidBytes.slice(), 4),
            display: JSON.stringify(uuid),
        },
        {
            name: 'legacy UUID Binary',
            tag: 'Binary',
            type: 'uuid-legacy',
            value: new bson.Binary(uuidBytes.slice(), 3),
            display: JSON.stringify(uuid),
        },
        {
            name: 'BSONRegExp',
            tag: 'BSONRegExp',
            type: 'regexp',
            value: new bson.BSONRegExp('abc', 'i'),
            display: 'abc i',
        },
        { name: 'BSONSymbol', tag: 'BSONSymbol', type: 'symbol', value: new bson.BSONSymbol('s'), display: 's' },
        {
            name: 'Code',
            tag: 'Code',
            type: 'code',
            value: new bson.Code('return 1;'),
            display: '{"code":"return 1;"}',
        },
        {
            name: 'Code with scope',
            tag: 'Code',
            type: 'codewithscope',
            value: new bson.Code('return x;', { x: new bson.Int32(1) }),
            display: '{"code":"return x;","scope":{"x":1}}',
        },
        {
            name: 'DBRef',
            tag: 'DBRef',
            type: 'dbref',
            value: reference,
            display: `{"$ref":"collection","$id":"${objectId}","$db":"database"}`,
        },
        { name: 'MinKey', tag: 'MinKey', type: 'minkey', value: new bson.MinKey(), display: 'MinKey' },
        { name: 'MaxKey', tag: 'MaxKey', type: 'maxkey', value: new bson.MaxKey(), display: 'MaxKey' },
    ];
}

function schema(value: unknown): JSONSchema {
    return SchemaAnalyzer.fromDocument({ value }).getSchema();
}

function fieldVariant(value: unknown): JSONSchema {
    const field = schema(value).properties!['value'] as JSONSchema;
    return field.anyOf![0] as JSONSchema;
}

const referenceSamples = samples(currentBson);
const binaryCases = [0, 3, 4].flatMap((subtype) =>
    [0, 15, 16, 17].map((length) => ({
        subtype,
        length,
        type: (length === 16 && subtype !== 0 ? (subtype === 3 ? 'uuid-legacy' : 'uuid') : 'binary') as BSONType,
    })),
);

describe.each(versions)('BSON $name version compatibility', ({ name, alias, major, bson: esm }) => {
    const cjs = require(alias) as BsonFixtureModule;

    it('loads genuinely independent CJS and ESM constructors', () => {
        expect(cjs.ObjectId).not.toBe(esm.ObjectId);
        expect(cjs.Binary).not.toBe(esm.Binary);
        expect(new cjs.ObjectId(objectId)).not.toBeInstanceOf(esm.ObjectId);
        expect(new esm.ObjectId(objectId)).not.toBeInstanceOf(cjs.ObjectId);
    });

    describe.each([
        { source: 'ESM', bson: esm },
        { source: 'CJS', bson: cjs },
    ])('$source', ({ bson }) => {
        const fixtures = samples(bson);

        it('covers all thirteen inherited BSON tags with the supported major marker', () => {
            expect(new Set(fixtures.map(({ tag }) => tag)).size).toBe(13);
            for (const { value, tag } of fixtures) {
                if (typeof value !== 'object' || value === null) throw new TypeError('Expected a BSON wrapper');
                expect(value).toHaveProperty('_bsontype', tag);
                expect(Object.hasOwn(value, '_bsontype')).toBe(false);
                expect(Reflect.get(value, versionMarker)).toBe(major);
            }
        });

        it.each(fixtures)(
            'infers, formats and analyzes direct $name consistently',
            ({ name, value, type, display }) => {
                const reference = referenceSamples.find((sample) => sample.name === name)!;
                expect(inferBsonType(value)).toBe(type);
                expect(valueToDisplayString(value, inferBsonType(value))).toBe(display);
                expect(schema(value)).toEqual(schema(reference.value));
                expect(fieldVariant(value)['x-bsonType']).toBe(type);
            },
        );

        it.each(fixtures)(
            'infers, formats and analyzes wire-decoded $name consistently',
            ({ name, value, type, display }) => {
                const decoded = roundTrip(bson, value);
                const reference = referenceSamples.find((sample) => sample.name === name)!;
                expect(inferBsonType(decoded)).toBe(type);
                expect(valueToDisplayString(decoded, inferBsonType(decoded))).toBe(display);
                expect(schema(decoded)).toEqual(schema(roundTrip(currentBson, reference.value)));
            },
        );

        it('retains Code scope and DBRef traversal instead of treating them as scalar leaves', () => {
            const scoped = new bson.Code('return x;', { x: new bson.Int32(1) });
            const reference = roundTrip(bson, { $ref: 'collection', $id: 'customer-123', extra: new bson.Int32(2) });
            expect(fieldVariant(scoped)).toMatchObject({
                'x-bsonType': 'codewithscope',
                properties: {
                    code: { anyOf: [{ 'x-bsonType': 'string' }] },
                    scope: {
                        anyOf: [{ properties: { x: { anyOf: [{ 'x-bsonType': 'int32' }] } } }],
                    },
                },
            });
            expect(fieldVariant(reference)).toMatchObject({
                'x-bsonType': 'dbref',
                properties: {
                    collection: { anyOf: [{ 'x-bsonType': 'string' }] },
                    oid: { anyOf: [{ 'x-bsonType': 'string' }] },
                    fields: {
                        anyOf: [{ properties: { extra: { anyOf: [{ 'x-bsonType': 'int32' }] } } }],
                    },
                },
            });
        });

        it('accounts for default wire promotions rather than requiring unchanged wrapper tags', () => {
            const decoded = bson.deserialize(
                bson.serialize({
                    int32: new bson.Int32(42),
                    double: new bson.Double(1.25),
                    long: bson.Long.fromNumber(123),
                    symbol: new bson.BSONSymbol('s'),
                    regexp: new bson.BSONRegExp('abc', 'i'),
                    scoped: new bson.Code('return x;', { x: new bson.Int32(1) }),
                }),
            );
            expect(decoded).toMatchObject({ int32: 42, double: 1.25, long: 123, symbol: 's', regexp: /abc/i });
            for (const field of ['int32', 'double', 'long']) {
                expect(inferBsonType(decoded[field])).toBe('double');
            }
            expect(inferBsonType(decoded.symbol)).toBe('string');
            expect(inferBsonType(decoded.regexp)).toBe('regexp');
            expect(schema(decoded.scoped)).toEqual(schema(new currentBson.Code('return x;', { x: 1 })));
        });

        it.each(binaryCases)(
            'classifies Binary subtype $subtype with $length used bytes',
            ({ subtype, length, type }) => {
                const binary = new bson.Binary(new Uint8Array(length), subtype);
                expect(inferBsonType(binary)).toBe(type);
                expect(schema(binary)).toEqual(schema(new currentBson.Binary(new Uint8Array(length), subtype)));
                expect(valueToDisplayString(binary, type)).toBe(
                    type === 'binary' ? `Binary[${length}]` : '"00000000-0000-0000-0000-000000000000"',
                );
            },
        );

        // BSON 5.0.0 always constructs a UUID for subtype 4 during decoding, rejecting other sizes.
        it.each(binaryCases.filter(({ subtype, length }) => name !== '5.0.0' || subtype !== 4 || length === 16))(
            'decodes Binary subtype $subtype with $length used bytes consistently',
            ({ subtype, length, type }) => {
                const decoded = roundTrip(bson, new bson.Binary(new Uint8Array(length), subtype));
                expect(inferBsonType(decoded)).toBe(type);
                expect(schema(decoded)).toEqual(schema(new currentBson.Binary(new Uint8Array(length), subtype)));
                expect(valueToDisplayString(decoded, type)).toBe(
                    type === 'binary' ? `Binary[${length}]` : '"00000000-0000-0000-0000-000000000000"',
                );
            },
        );

        it.each([3, 4])('formats subtype %i from used bytes, without requiring UUID methods', (subtype) => {
            const binary = new bson.Binary(new Uint8Array(32), subtype);
            binary.buffer.set(uuidBytes);
            binary.position = 16;
            expect(binary).not.toHaveProperty('toHexString');
            const type = subtype === 3 ? 'uuid-legacy' : 'uuid';
            expect(inferBsonType(binary)).toBe(type);
            expect(valueToDisplayString(binary, type)).toBe(JSON.stringify(uuid));
            expect(valueToDisplayString(roundTrip(bson, binary), type)).toBe(JSON.stringify(uuid));
        });

        it('aggregates binary lengths using position rather than allocation capacity', () => {
            const binary = new bson.Binary();
            binary.put(1);
            expect(binary.buffer.byteLength).toBeGreaterThan(binary.position);
            const analyzer = SchemaAnalyzer.fromDocuments([
                { value: binary },
                { value: new currentBson.Binary(new Uint8Array(5)) },
            ]);
            const field = analyzer.getSchema().properties!['value'] as JSONSchema;
            expect(field.anyOf).toEqual([
                expect.objectContaining({
                    'x-bsonType': 'binary',
                    'x-minLength': 1,
                    'x-maxLength': 5,
                    'x-typeOccurrence': 2,
                }),
            ]);
        });
    });
});

describe.each([
    { source: 'ESM', bson: bson50 },
    { source: 'CJS', bson: require('bson-v5-0') as BsonFixtureModule },
])('BSON 5.0.0 $source wire limitations', ({ bson }) => {
    it.each([0, 15, 17])('cannot decode a subtype-4 Binary containing %i bytes', (length) => {
        const binary = new bson.Binary(new Uint8Array(length), 4);
        expect(inferBsonType(binary)).toBe('binary');
        expect(() => roundTrip(bson, binary)).toThrow();
    });
});

describe('unsupported BSON 4.7.2 wrappers', () => {
    const fixtures = samples(bson4);

    it.each(fixtures.filter(({ name }) => name !== 'Timestamp'))('fails closed for markerless $name', ({ value }) => {
        if (typeof value !== 'object' || value === null) throw new TypeError('Expected a BSON wrapper');
        expect(Object.hasOwn(value, '_bsontype')).toBe(false);
        expect(value).toHaveProperty('toExtendedJSON', expect.any(Function));
        expect(Reflect.get(value, versionMarker)).toBeUndefined();
        expect(inferBsonType(value)).toBe('_unknown_');
        expect(valueToDisplayString(value, inferBsonType(value))).toBe('Unknown');
        expect(fieldVariant(value)['x-bsonType']).toBe('_unknown_');
    });

    it('keeps the legacy Timestamp own tag on the ordinary-object path', () => {
        const timestamp = new bson4.Timestamp({ t: 1, i: 2 });
        expect(Object.hasOwn(timestamp, '_bsontype')).toBe(true);
        expect(inferBsonType(timestamp)).toBe('object');
    });
});
