/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Binary, deserialize, EJSON, ObjectId, serialize } from 'bson';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import { type JSONSchema } from '../JSONSchema.js';
import { inferBsonType, SchemaAnalyzer, valueToDisplayString } from './index.js';

const bsonVersion = Symbol.for('@@mdb.bson.version');

function wrapper(tag: unknown, fields: Record<string, unknown> = {}, version: unknown = 7): object {
    class Wrapper {
        get _bsontype(): unknown {
            return tag;
        }

        get [bsonVersion](): unknown {
            return version;
        }
    }
    return Object.assign(new Wrapper(), fields);
}

describe('BSON protocol recognition', () => {
    it.each(['FutureType', '', '__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty'])(
        'preserves a wrapper with unsupported tag %s as an unknown leaf',
        (tag) => {
            const value = wrapper(tag, { internal: 42 });
            expect(inferBsonType(value)).toBe('_unknown_');
            expect(valueToDisplayString(value, inferBsonType(value))).toBe('Unknown');
            const analyzer = SchemaAnalyzer.fromDocuments([{ value }, { value }]);
            expect(analyzer.getKnownFields()).toEqual([{ path: 'value', type: 'string', dataType: '_unknown_' }]);
            expect((analyzer.getSchema().properties!['value'] as JSONSchema).anyOf).toEqual([
                { type: 'string', 'x-bsonType': '_unknown_', 'x-typeOccurrence': 2 },
            ]);
        },
    );

    it.each([4, 8, 0, -1, 7.5, NaN, Infinity])(
        'does not recognize wrappers from unsupported BSON version %s',
        (version) => {
            const value = wrapper('MinKey', {}, version);
            expect(inferBsonType(value)).toBe('_unknown_');
            expect(SchemaAnalyzer.fromDocument({ value }).getKnownFields()).toEqual([
                { path: 'value', type: 'string', dataType: '_unknown_' },
            ]);
        },
    );

    it.each([5, 6, 7])('uses version %s rather than requiring a serialization method', (version) => {
        expect(inferBsonType(wrapper('MinKey', {}, version))).toBe('minkey');
    });

    it('treats a markerless inherited BSON protocol as unsupported', () => {
        class LegacyValue {
            get _bsontype(): string {
                return 'ObjectID';
            }
            toExtendedJSON(): object {
                throw new Error('Inference must not serialize');
            }
        }
        expect(inferBsonType(new LegacyValue())).toBe('_unknown_');
    });

    it.each([undefined, null, {}, 42])('does not recognize a non-string tag: %s', (tag) => {
        expect(inferBsonType(wrapper(tag, { nested: true }))).toBe('object');
    });

    it.each([
        { tag: 'ObjectId', fields: { id: new Uint8Array(11), toHexString: () => '' } },
        { tag: 'Int32', fields: { value: '42' } },
        { tag: 'Double', fields: { value: '1.25' } },
        { tag: 'Long', fields: { low: 1, high: '0', unsigned: false } },
        { tag: 'Timestamp', fields: { low: 1, high: 0 } },
        { tag: 'Decimal128', fields: { bytes: new Uint8Array(15) } },
        { tag: 'Binary', fields: { buffer: new Uint8Array(3), position: 4, sub_type: 0, length: () => 4 } },
        { tag: 'BSONRegExp', fields: { pattern: 'abc', options: 123 } },
        { tag: 'BSONSymbol', fields: { value: 123 } },
        { tag: 'Code', fields: { code: 123 } },
        { tag: 'DBRef', fields: { collection: 'c' } },
    ])('does not traverse the incompatible shape of a $tag wrapper', ({ tag, fields }) => {
        const value = wrapper(tag, fields);
        expect(inferBsonType(value)).toBe('_unknown_');
        expect(SchemaAnalyzer.fromDocument({ value }).getKnownFields()).toEqual([
            { path: 'value', type: 'string', dataType: '_unknown_' },
        ]);
    });

    it.each([
        { name: 'own tag', value: { _bsontype: 'MinKey', nested: 1, [bsonVersion]: 7 } },
        { name: 'null prototype', value: Object.assign(Object.create(null), { _bsontype: 'MinKey', nested: 1 }) },
        { name: 'shadowed hasOwnProperty', value: { _bsontype: 'MinKey', nested: 1, hasOwnProperty: false } },
        {
            name: 'own tag over inherited tag',
            value: Object.defineProperty(wrapper('MaxKey'), '_bsontype', { value: 'MinKey', enumerable: true }),
        },
        { name: 'foreign document', value: runInNewContext('({ _bsontype: "MinKey", nested: 1 })') },
    ])('preserves ordinary document fields: $name', ({ value }) => {
        expect(inferBsonType(value)).toBe('object');
        expect(SchemaAnalyzer.fromDocument({ value }).getKnownFields()).toContainEqual({
            path: 'value._bsontype',
            type: 'string',
            dataType: 'string',
        });
    });

    it('does not read a tag inherited from Object.prototype on ordinary documents', () => {
        const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, '_bsontype');
        const readTag = vi.fn(() => 'MinKey');
        try {
            Object.defineProperty(Object.prototype, '_bsontype', { configurable: true, get: readTag });
            expect(inferBsonType({ nested: 1 })).toBe('object');
            expect(inferBsonType(Object.create(null))).toBe('object');
            expect(readTag).not.toHaveBeenCalled();
        } finally {
            if (descriptor) Object.defineProperty(Object.prototype, '_bsontype', descriptor);
            else Reflect.deleteProperty(Object.prototype, '_bsontype');
        }
    });

    it('propagates errors from a wrapper version getter', () => {
        const failure = new Error('Unreadable BSON version');
        const value = Object.defineProperty(wrapper('MinKey'), bsonVersion, {
            get() {
                throw failure;
            },
        });
        expect(() => inferBsonType(value)).toThrow(failure);
    });

    it('keeps unknown values in arrays without walking into their fields', () => {
        const analyzer = SchemaAnalyzer.fromDocument({ values: [wrapper('FutureType', { internal: 1 }), Symbol('x')] });
        const array = (analyzer.getSchema().properties!['values'] as JSONSchema).anyOf![0] as JSONSchema;
        expect((array.items as JSONSchema).anyOf).toEqual([
            { type: 'string', 'x-bsonType': '_unknown_', 'x-typeOccurrence': 2 },
        ]);
    });
});

describe('Binary subtype inference', () => {
    it.each([
        { subtype: 0, type: 'binary' },
        { subtype: 3, type: 'uuid-legacy' },
        { subtype: 4, type: 'uuid' },
    ] as const)('preserves subtype $subtype through a BSON round trip', ({ subtype, type }) => {
        const original = new Binary(
            Uint8Array.from({ length: 16 }, (_, index) => index),
            subtype,
        );
        const restored: unknown = deserialize(serialize({ value: original })).value;
        expect(inferBsonType(original)).toBe(type);
        expect(inferBsonType(restored)).toBe(type);
        expect(valueToDisplayString(restored, type)).toBe(valueToDisplayString(original, type));
        const analyzer = SchemaAnalyzer.fromDocuments([{ value: original }, { value: restored }]);
        expect((analyzer.getSchema().properties!['value'] as JSONSchema).anyOf).toHaveLength(1);
    });

    it.each([0, 15, 17])('leaves UUID subtypes with %s used bytes classified as binary', (length) => {
        for (const subtype of [3, 4]) {
            const value = new Binary(new Uint8Array(length), subtype);
            expect(inferBsonType(value)).toBe('binary');
            expect(valueToDisplayString(value, inferBsonType(value))).toBe(`Binary[${length}]`);
        }
    });
});

describe('Invalid BSON dates', () => {
    function outOfRangeDate(): Date {
        const bytes = Buffer.alloc(16);
        bytes.writeInt32LE(16, 0);
        bytes[4] = 0x09;
        bytes[5] = 0x64;
        bytes.writeBigInt64LE(9223372036854775807n, 7);
        const value: unknown = deserialize(bytes).d;
        if (!(value instanceof Date)) throw new Error('Expected a BSON date');
        return value;
    }

    const placements = [
        {
            name: 'field',
            analyze: (values: Date[]) => {
                const schema = SchemaAnalyzer.fromDocuments(values.map((value) => ({ value }))).getSchema();
                return (schema.properties!['value'] as JSONSchema).anyOf![0];
            },
        },
        {
            name: 'nested field',
            analyze: (values: Date[]) => {
                const schema = SchemaAnalyzer.fromDocuments(values.map((value) => ({ nested: { value } }))).getSchema();
                const nested = (schema.properties!['nested'] as JSONSchema).anyOf![0] as JSONSchema;
                return (nested.properties!['value'] as JSONSchema).anyOf![0];
            },
        },
        {
            name: 'array element',
            analyze: (values: Date[]) => {
                const schema = SchemaAnalyzer.fromDocument({ values }).getSchema();
                const array = (schema.properties!['values'] as JSONSchema).anyOf![0] as JSONSchema;
                return (array.items as JSONSchema).anyOf![0];
            },
        },
    ];

    it('formats an out-of-range date deserialized from real BSON', () => {
        const value = outOfRangeDate();
        expect(Number.isNaN(value.getTime())).toBe(true);
        expect(inferBsonType(value)).toBe('date');
        expect(valueToDisplayString(value, inferBsonType(value))).toBe('Invalid Date');
    });

    describe.each(placements)('$name statistics', ({ analyze }) => {
        it.each([
            [NaN, 0, 100],
            [0, 100, NaN],
            [NaN, 100, NaN, 0, NaN],
        ])('ignores invalid values regardless of order: %j', (...timestamps) => {
            const entry = analyze(
                timestamps.map((timestamp) => (Number.isNaN(timestamp) ? outOfRangeDate() : new Date(timestamp))),
            );
            expect(entry).toMatchObject({
                'x-bsonType': 'date',
                'x-minDate': 0,
                'x-maxDate': 100,
                'x-typeOccurrence': timestamps.length,
            });
        });

        it('omits bounds if all dates are invalid but counts their occurrences', () => {
            const entry = analyze([outOfRangeDate(), new Date(NaN)]);
            expect(entry).toEqual({ type: 'string', 'x-bsonType': 'date', 'x-typeOccurrence': 2 });
        });
    });
});

describe('BSON worker transport contract', () => {
    it('preserves BSON wrappers through canonical EJSON rather than structuredClone', () => {
        const document = {
            id: new ObjectId('507f1f77bcf86cd799439011'),
            legacy: new Binary(new Uint8Array(16), 3),
        };
        const cloned = structuredClone(document);
        expect(inferBsonType(cloned.id)).toBe('object');
        expect(inferBsonType(cloned.legacy)).toBe('object');
        const restored: Record<string, unknown> = EJSON.parse(EJSON.stringify(document, { relaxed: false }), {
            relaxed: false,
        });
        expect(inferBsonType(restored.id)).toBe('objectid');
        expect(inferBsonType(restored.legacy)).toBe('uuid-legacy');
        expect(SchemaAnalyzer.fromDocument(restored).getSchema()).toEqual(
            SchemaAnalyzer.fromDocument(document).getSchema(),
        );
    });
});
