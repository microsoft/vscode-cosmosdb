/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ObjectId } from 'mongodb';
import { afterEach, describe, expect, it } from 'vitest';
import { SchemaAnalyzer } from '../bson/index.js';
import { getKnownFields, getPropertyNamesAtLevel, getSchemaAtPath, simplifySchema, type JSONSchema } from '../index.js';
import { getSchemaFromDocument, getSchemaFromDocuments, updateSchemaWithDocument } from '../json/index.js';

const reservedNames = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
const builtinSnapshots = [
    Object.prototype,
    Object,
    Object.prototype.toString,
    Object.prototype.hasOwnProperty,
    Object.prototype.valueOf,
].map((value) => ({ value, descriptors: Object.getOwnPropertyDescriptors(value) }));

afterEach(() => {
    const actual = builtinSnapshots.map(({ value }) => Object.getOwnPropertyDescriptors(value));

    // Restore built-ins before reporting failures so a regression cannot contaminate subsequent tests.
    for (const { value, descriptors } of builtinSnapshots) {
        for (const key of Reflect.ownKeys(value)) {
            if (!Object.hasOwn(descriptors, key)) {
                Reflect.deleteProperty(value, key);
            }
        }
        Object.defineProperties(value, descriptors);
    }

    expect(actual).toEqual(builtinSnapshots.map(({ descriptors }) => descriptors));
});

describe.each([
    {
        name: 'JSON',
        create(document: Record<string, unknown>) {
            const schema = getSchemaFromDocument(document);
            return {
                getSchema: () => schema,
                update: (next: Record<string, unknown>) => updateSchemaWithDocument(schema, next),
                fields: () => getKnownFields(schema, 'x-dataType'),
            };
        },
    },
    {
        name: 'BSON',
        create(document: Record<string, unknown>) {
            const analyzer = SchemaAnalyzer.fromDocument({ _id: new ObjectId(), ...document });
            return {
                getSchema: () => analyzer.getSchema(),
                update: (next: Record<string, unknown>) => analyzer.addDocument({ _id: new ObjectId(), ...next }),
                fields: () => analyzer.getKnownFields(),
            };
        },
    },
])('$name property safety', ({ create }) => {
    it.each(reservedNames)('preserves and updates an own "%s" field', (name) => {
        const { getSchema, update, fields } = create({ [name]: 1 });
        const initial = getSchema();
        expect(Object.hasOwn(initial.properties!, name)).toBe(true);
        expect(Object.getPrototypeOf(initial.properties)).toBe(Object.prototype);

        update({ [name]: 2 });

        const schema = getSchema();
        const field = schema.properties![name] as JSONSchema;
        expect(field['x-occurrence']).toBe(2);
        expect(field.anyOf).toHaveLength(1);
        expect(field.anyOf![0]).toMatchObject({
            type: 'number',
            'x-typeOccurrence': 2,
            'x-minValue': 1,
            'x-maxValue': 2,
        });
        expect(getPropertyNamesAtLevel(schema, [])).toContain(name);
        expect(fields()).toContainEqual(expect.objectContaining({ path: name, type: 'number' }));

        simplifySchema(schema);
        expect(field.type).toBe('number');
        expect(field.anyOf).toBeUndefined();
        const serialized: JSONSchema = JSON.parse(JSON.stringify(schema));
        expect(Object.hasOwn(serialized.properties!, name)).toBe(true);
        expect(serialized.properties![name]).toEqual(field);
    });

    it.each(reservedNames)('navigates through own nested "%s" fields', (name) => {
        const { getSchema, update, fields } = create({ [name]: { [name]: 1 } });
        update({ [name]: { [name]: 2 } });

        const schema = getSchema();
        const nested = getSchemaAtPath(schema, [name])!;
        expect(Object.hasOwn(nested.properties!, name)).toBe(true);
        expect(getPropertyNamesAtLevel(schema, [name])).toEqual([name]);
        expect((nested.properties![name] as JSONSchema)['x-occurrence']).toBe(2);
        expect(fields()).toContainEqual(expect.objectContaining({ path: `${name}.${name}`, type: 'number' }));
        simplifySchema(schema);
        expect(getSchemaAtPath(schema, [name])).toMatchObject({ type: 'object' });
        expect(getPropertyNamesAtLevel(schema, [name])).toEqual([name]);
    });

    it.each(reservedNames)('preserves "%s" fields in array elements', (name) => {
        const { getSchema, update } = create({ values: [{ [name]: 1 }] });
        update({ values: [{ [name]: 2 }] });

        const schema = getSchema();
        const array = (schema.properties!['values'] as JSONSchema).anyOf![0] as JSONSchema;
        const element = (array.items as JSONSchema).anyOf![0] as JSONSchema;
        expect(Object.hasOwn(element.properties!, name)).toBe(true);
        expect(getPropertyNamesAtLevel(element, [])).toEqual([name]);
        expect(getPropertyNamesAtLevel(schema, ['values'])).toEqual([name]);
        expect((element.properties![name] as JSONSchema)['x-occurrence']).toBe(2);

        simplifySchema(schema);
        const simplifiedArray = schema.properties!['values'] as JSONSchema;
        const simplifiedElement = simplifiedArray.items as JSONSchema;
        expect((simplifiedElement.properties![name] as JSONSchema).type).toBe('number');
        expect(getPropertyNamesAtLevel(schema, ['values'])).toEqual([name]);
    });

    it.each(reservedNames)('rejects absent "%s" fields in schema paths', (name) => {
        const schema = create({ nested: { visible: 1 } }).getSchema();
        expect(() => getSchemaAtPath(schema, [name])).toThrow('No properties found');
        expect(() => getPropertyNamesAtLevel(schema, ['nested', name])).toThrow('No properties found');
    });

    it('ignores inherited, non-enumerable and symbol document fields', () => {
        const nested = { visible: 1, hasOwnProperty: 2 };
        Object.setPrototypeOf(nested, { inherited: 3 });
        Object.defineProperty(nested, 'hidden', { value: 4 });
        Object.defineProperty(nested, Symbol('symbol'), { value: 5, enumerable: true });
        const schema = create({ nested }).getSchema();

        expect(getPropertyNamesAtLevel(schema, ['nested'])).toEqual(['hasOwnProperty', 'visible']);
        expect(() => getSchemaAtPath(schema, ['nested', 'inherited'])).toThrow('No properties found');
    });

    it('preserves a parsed JSON "__proto__" field without modifying prototypes', () => {
        const document: Record<string, unknown> = JSON.parse('{"__proto__":1}');
        const schema = create(document).getSchema();

        expect(Object.hasOwn(schema.properties!, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(schema.properties)).toBe(Object.prototype);
        expect(schema.properties!['__proto__']).toMatchObject({
            'x-occurrence': 1,
            anyOf: [expect.objectContaining({ type: 'number', 'x-typeOccurrence': 1 })],
        });
    });
});

describe('JSON property safety with existing schemas', () => {
    it.each(reservedNames)('updates a serialized schema containing "%s"', (name) => {
        const schema: JSONSchema = JSON.parse(JSON.stringify(getSchemaFromDocument({ [name]: 1 })));
        updateSchemaWithDocument(schema, { [name]: 2 });

        expect(Object.hasOwn(schema.properties!, name)).toBe(true);
        expect((schema.properties![name] as JSONSchema)['x-occurrence']).toBe(2);
        expect(Object.getPrototypeOf(schema.properties)).toBe(Object.prototype);
    });

    it.each(reservedNames)('includes "%s" in batch-generated schemas', (name) => {
        const schema = getSchemaFromDocuments([{ [name]: 1 }, { [name]: 2 }]);
        expect(Object.hasOwn(schema.properties!, name)).toBe(true);
        expect(schema.properties![name]).toMatchObject({ type: 'number', 'x-occurrence': 2 });
    });

    it.each(reservedNames)('updates a serialized simplified schema containing "%s"', (name) => {
        const schema: JSONSchema = JSON.parse(JSON.stringify(getSchemaFromDocuments([{ [name]: 1 }])));
        updateSchemaWithDocument(schema, { [name]: 2 });
        simplifySchema(schema);
        updateSchemaWithDocument(schema, { [name]: 'text' });

        expect(Object.hasOwn(schema.properties!, name)).toBe(true);
        expect(Object.getPrototypeOf(schema.properties)).toBe(Object.prototype);
        expect(schema.properties![name]).toMatchObject({
            'x-occurrence': 3,
            anyOf: [
                { type: 'number', 'x-typeOccurrence': 2, 'x-minValue': 1, 'x-maxValue': 2 },
                { type: 'string', 'x-typeOccurrence': 1, 'x-minLength': 4, 'x-maxLength': 4 },
            ],
        });
        expect(getPropertyNamesAtLevel(schema, [])).toEqual([name]);
    });

    it('does not reuse inherited schema properties or invoke inherited setters', () => {
        const inherited: JSONSchema = { anyOf: [{ type: 'number', 'x-dataType': 'number', 'x-typeOccurrence': 1 }] };
        const properties = {};
        let setterCalled = false;
        Object.setPrototypeOf(
            properties,
            Object.defineProperty({}, 'inherited', {
                get: () => inherited,
                set: () => {
                    setterCalled = true;
                },
            }),
        );
        const schema: JSONSchema = { properties };

        expect(getPropertyNamesAtLevel(schema, [])).toEqual([]);
        expect(() => getSchemaAtPath(schema, ['inherited'])).toThrow('No properties found');
        updateSchemaWithDocument(schema, { inherited: 2 });

        expect(setterCalled).toBe(false);
        expect(Object.hasOwn(properties, 'inherited')).toBe(true);
        expect(schema.properties!['inherited']).not.toBe(inherited);
        expect(inherited).toEqual({ anyOf: [{ type: 'number', 'x-dataType': 'number', 'x-typeOccurrence': 1 }] });
    });
});
