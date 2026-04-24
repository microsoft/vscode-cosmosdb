/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type JSONSchema } from '../index.js';
import {
    buildFullPaths,
    getPropertyNamesAtLevel,
    getSchemaFromDocument,
    getSchemaFromDocuments,
    inferNoSqlType,
    updateSchemaWithDocument,
} from './index.js';

// ── Type inference ─────────────────────────────────────────────────────

describe('JSON inferNoSqlType', () => {
    it('infers primitive types', () => {
        expect(inferNoSqlType('hello')).toBe('string');
        expect(inferNoSqlType(42)).toBe('number');
        expect(inferNoSqlType(3.14)).toBe('number');
        expect(inferNoSqlType(true)).toBe('boolean');
        expect(inferNoSqlType(false)).toBe('boolean');
        expect(inferNoSqlType(null)).toBe('null');
        expect(inferNoSqlType(undefined)).toBe('undefined');
    });

    it('infers structural types', () => {
        expect(inferNoSqlType([])).toBe('array');
        expect(inferNoSqlType([1, 2, 3])).toBe('array');
        expect(inferNoSqlType({})).toBe('object');
        expect(inferNoSqlType({ a: 1 })).toBe('object');
    });
});

// ── Single-document schema ─────────────────────────────────────────────

describe('JSON getSchemaFromDocument', () => {
    it('creates a schema from a flat document', () => {
        const schema = getSchemaFromDocument({ name: 'Alice', age: 30, active: true });

        expect(schema['x-documentsInspected']).toBe(1);
        expect(schema.properties).toHaveProperty('name');
        expect(schema.properties).toHaveProperty('age');
        expect(schema.properties).toHaveProperty('active');

        const nameField = schema.properties!['name'] as JSONSchema;
        expect(nameField['x-occurrence']).toBe(1);

        const nameAnyOf = nameField.anyOf as JSONSchema[];
        expect(nameAnyOf).toHaveLength(1);
        expect(nameAnyOf[0]['x-dataType']).toBe('string');
        expect(nameAnyOf[0].type).toBe('string');
    });

    it('creates a schema with nested objects', () => {
        const schema = getSchemaFromDocument({
            user: {
                name: 'Alice',
                address: { city: 'NY', zip: '10001' },
            },
        });

        const userField = schema.properties!['user'] as JSONSchema;
        const userObj = userField.anyOf?.[0] as JSONSchema;
        expect(userObj.type).toBe('object');
        expect(userObj.properties).toHaveProperty('name');
        expect(userObj.properties).toHaveProperty('address');

        const addressObj = (userObj.properties!['address'] as JSONSchema).anyOf?.[0] as JSONSchema;
        expect(addressObj.properties).toHaveProperty('city');
        expect(addressObj.properties).toHaveProperty('zip');
    });

    it('creates a schema with arrays', () => {
        const schema = getSchemaFromDocument({ tags: ['a', 'b', 'c'] });

        const tagsField = schema.properties!['tags'] as JSONSchema;
        const arrayEntry = tagsField.anyOf?.[0] as JSONSchema;
        expect(arrayEntry.type).toBe('array');
        expect(arrayEntry['x-minItems']).toBe(3);
        expect(arrayEntry['x-maxItems']).toBe(3);

        const itemEntry = (arrayEntry.items as JSONSchema).anyOf?.[0] as JSONSchema;
        expect(itemEntry['x-dataType']).toBe('string');
        expect(itemEntry['x-typeOccurrence']).toBe(3);
    });
});

// ── Multi-document schema ──────────────────────────────────────────────

describe('JSON getSchemaFromDocuments', () => {
    it('throws on empty input', () => {
        expect(() => getSchemaFromDocuments([])).toThrow();
    });

    it('merges multiple documents and simplifies single-type fields', () => {
        const schema = getSchemaFromDocuments([
            { name: 'Alice', age: 30 },
            { name: 'Bob', age: 25, email: 'bob@test.com' },
        ]);

        expect(schema['x-documentsInspected']).toBe(2);

        // After simplifySchema, single-type fields are unwrapped
        const nameField = schema.properties!['name'] as JSONSchema;
        expect(nameField.type).toBe('string');
        expect(nameField['x-dataType']).toBe('string');
        expect(nameField['x-occurrence']).toBe(2);

        // 'email' is sparse
        const emailField = schema.properties!['email'] as JSONSchema;
        expect(emailField['x-occurrence']).toBe(1);
    });

    it('handles polymorphic fields', () => {
        const schema = getSchemaFromDocuments([{ value: 'hello' }, { value: 42 }, { value: true }, { value: 'world' }]);

        const valueField = schema.properties!['value'] as JSONSchema;
        // Not simplified — multiple types
        expect(valueField.anyOf).toBeDefined();
        const types = (valueField.anyOf as JSONSchema[]).map((e) => e['x-dataType']);
        expect(types).toContain('string');
        expect(types).toContain('number');
        expect(types).toContain('boolean');

        const strEntry = (valueField.anyOf as JSONSchema[]).find((e) => e['x-dataType'] === 'string')!;
        expect(strEntry['x-typeOccurrence']).toBe(2);
    });

    it('collects string min/max length statistics', () => {
        const schema = getSchemaFromDocuments([{ s: 'ab' }, { s: 'abcdef' }, { s: 'abcd' }]);

        const sField = schema.properties!['s'] as JSONSchema;
        expect(sField['x-minLength']).toBe(2);
        expect(sField['x-maxLength']).toBe(6);
    });

    it('collects number min/max statistics', () => {
        const schema = getSchemaFromDocuments([{ n: 10 }, { n: -5 }, { n: 100 }]);

        const nField = schema.properties!['n'] as JSONSchema;
        expect(nField['x-minValue']).toBe(-5);
        expect(nField['x-maxValue']).toBe(100);
    });

    it('collects boolean true/false counts', () => {
        const schema = getSchemaFromDocuments([{ b: true }, { b: false }, { b: true }, { b: true }]);

        const bField = schema.properties!['b'] as JSONSchema;
        expect(bField['x-trueCount']).toBe(3);
        expect(bField['x-falseCount']).toBe(1);
    });

    it('collects object min/max property counts', () => {
        const schema = getSchemaFromDocuments([{ o: { a: 1 } }, { o: { a: 1, b: 2, c: 3 } }]);

        const oField = schema.properties!['o'] as JSONSchema;
        expect(oField['x-minProperties']).toBe(1);
        expect(oField['x-maxProperties']).toBe(3);
    });

    it('collects array min/max item counts', () => {
        const schema = getSchemaFromDocuments([{ a: [1] }, { a: [1, 2, 3, 4, 5] }, { a: [1, 2] }]);

        const aField = schema.properties!['a'] as JSONSchema;
        expect(aField['x-minItems']).toBe(1);
        expect(aField['x-maxItems']).toBe(5);
    });
});

// ── Incremental update ─────────────────────────────────────────────────

describe('JSON updateSchemaWithDocument', () => {
    it('incrementally adds documents to a schema', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, { name: 'Alice', age: 30 });
        expect(schema['x-documentsInspected']).toBe(1);

        updateSchemaWithDocument(schema, { name: 'Bob', email: 'bob@test.com' });
        expect(schema['x-documentsInspected']).toBe(2);
        expect(schema.properties).toHaveProperty('name');
        expect(schema.properties).toHaveProperty('age');
        expect(schema.properties).toHaveProperty('email');

        expect((schema.properties!['name'] as JSONSchema)['x-occurrence']).toBe(2);
        expect((schema.properties!['age'] as JSONSchema)['x-occurrence']).toBe(1);
        expect((schema.properties!['email'] as JSONSchema)['x-occurrence']).toBe(1);
    });
});

// ── Schema utilities ───────────────────────────────────────────────────

describe('JSON schema utilities', () => {
    const docs = [
        {
            user: {
                name: 'Alice',
                profile: {
                    bio: 'Hello',
                    hobbies: ['reading'],
                },
            },
            tags: ['admin'],
        },
        {
            user: {
                name: 'Bob',
                profile: {
                    bio: 'Hi',
                    age: 30,
                },
            },
        },
    ];

    it('getPropertyNamesAtLevel returns sorted names at root', () => {
        const schema = getSchemaFromDocument(docs[0]);
        const names = getPropertyNamesAtLevel(schema, []);
        expect(names).toEqual(['tags', 'user']);
    });

    it('getPropertyNamesAtLevel descends into nested objects', () => {
        const schema = getSchemaFromDocument(docs[0]);
        const names = getPropertyNamesAtLevel(schema, ['user']);
        expect(names).toEqual(['name', 'profile']);

        const profileNames = getPropertyNamesAtLevel(schema, ['user', 'profile']);
        expect(profileNames).toEqual(['bio', 'hobbies']);
    });

    it('getPropertyNamesAtLevel throws on invalid path', () => {
        const schema = getSchemaFromDocument(docs[0]);
        expect(() => getPropertyNamesAtLevel(schema, ['nonexistent'])).toThrow();
    });

    it('buildFullPaths constructs dot-notated paths', () => {
        const paths = buildFullPaths(['user', 'profile'], ['bio', 'age']);
        expect(paths).toEqual(['user.profile.bio', 'user.profile.age']);
    });
});

// ── Occurrence counting (JSON) ─────────────────────────────────────────

describe('JSON occurrence counting', () => {
    it('counts correctly for sparse fields', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, { a: 1, b: 2, c: 3 });
        updateSchemaWithDocument(schema, { a: 10 });
        updateSchemaWithDocument(schema, { a: 100, c: 300 });

        expect((schema.properties!['a'] as JSONSchema)['x-occurrence']).toBe(3);
        expect((schema.properties!['b'] as JSONSchema)['x-occurrence']).toBe(1);
        expect((schema.properties!['c'] as JSONSchema)['x-occurrence']).toBe(2);
    });

    it('counts occurrences in nested objects', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, { user: { name: 'Alice', age: 30 } });
        updateSchemaWithDocument(schema, { user: { name: 'Bob' } });

        const userField = schema.properties!['user'] as JSONSchema;
        const objEntry = userField.anyOf?.find((e) => (e as JSONSchema).type === 'object') as JSONSchema;
        expect((objEntry.properties!['name'] as JSONSchema)['x-occurrence']).toBe(2);
        expect((objEntry.properties!['age'] as JSONSchema)['x-occurrence']).toBe(1);
    });

    it('counts array element types across documents', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, { tags: ['a', 'b'] });
        updateSchemaWithDocument(schema, { tags: ['c', 42] });
        updateSchemaWithDocument(schema, { tags: [true] });

        const tagsField = schema.properties!['tags'] as JSONSchema;
        const arrEntry = tagsField.anyOf?.find((e) => (e as JSONSchema)['x-dataType'] === 'array') as JSONSchema;
        const items = arrEntry.items as JSONSchema;

        const strEntry = items.anyOf?.find((e) => (e as JSONSchema)['x-dataType'] === 'string') as JSONSchema;
        const boolEntry = items.anyOf?.find((e) => (e as JSONSchema)['x-dataType'] === 'boolean') as JSONSchema;

        expect(strEntry['x-typeOccurrence']).toBe(3);
        expect(boolEntry['x-typeOccurrence']).toBe(1);
    });

    it('preserves global min/max across multiple array instances', () => {
        const schema: JSONSchema = {};
        updateSchemaWithDocument(schema, { scores: [10, 20, 30] });
        updateSchemaWithDocument(schema, { scores: [5, 15] });

        const arrEntry = (schema.properties!['scores'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-dataType'] === 'array',
        ) as JSONSchema;
        const numEntry = (arrEntry.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-dataType'] === 'number',
        ) as JSONSchema;

        expect(numEntry['x-minValue']).toBe(5);
        expect(numEntry['x-maxValue']).toBe(30);
    });
});
