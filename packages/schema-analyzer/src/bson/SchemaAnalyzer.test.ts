/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getPropertyNamesAtLevel, SchemaAnalyzer } from './index.js';
import { type JSONSchema, type JSONSchemaMap, type JSONSchemaRef } from '../index.js';
import {
    arraysWithDifferentDataTypes,
    complexDocument,
    complexDocumentsArray,
    complexDocumentWithOddTypes,
    embeddedDocumentOnly,
    flatDocument,
    makeDoc,
    sparseDocumentsArray,
} from './fixtures.js';

// ── Basic schema inference ─────────────────────────────────────────────

describe('BSON SchemaAnalyzer — basic inference', () => {
    it('produces a schema from a single document', () => {
        const analyzer = SchemaAnalyzer.fromDocument(embeddedDocumentOnly);
        const schema = analyzer.getSchema();
        expect(schema).toBeDefined();
    });

    it('handles many documents with sparse fields', () => {
        const analyzer = SchemaAnalyzer.fromDocuments(sparseDocumentsArray);
        const schema = analyzer.getSchema();

        expect(schema['x-documentsInspected']).toBe(sparseDocumentsArray.length);

        const expectedRootProperties = new Set(['_id', 'name', 'age', 'email', 'isActive', 'score', 'description']);
        expect(Object.keys(schema.properties || {})).toEqual(
            expect.arrayContaining(Array.from(expectedRootProperties)),
        );

        // 'name' is a string
        const nameField = schema.properties?.['name'] as JSONSchema;
        expect(nameField?.['x-occurrence']).toBeGreaterThan(0);
        const nameFieldTypes = nameField.anyOf?.map((e) => (e as JSONSchema)['type']);
        expect(nameFieldTypes).toContain('string');

        // 'age' is a number
        const ageField = schema.properties?.['age'] as JSONSchema;
        const ageFieldTypes = ageField.anyOf?.map((e) => (e as JSONSchema)['type']);
        expect(ageFieldTypes).toContain('number');

        // 'isActive' is a boolean
        const isActiveField = schema.properties?.['isActive'] as JSONSchema;
        const isActiveTypes = isActiveField.anyOf?.map((e) => (e as JSONSchema)['type']);
        expect(isActiveTypes).toContain('boolean');

        // 'description' is optional
        const descriptionField = schema.properties?.['description'] as JSONSchema | undefined;
        expect(descriptionField).toBeDefined();
        expect(descriptionField?.['x-occurrence']).toBeLessThan(sparseDocumentsArray.length);
    });

    it('detects all BSON types from a flat document', () => {
        const analyzer = SchemaAnalyzer.fromDocument(flatDocument);
        const schema = analyzer.getSchema();

        const expectedFields = Object.keys(flatDocument);
        expect(Object.keys(schema.properties || {})).toEqual(expect.arrayContaining(expectedFields));

        function getBsonType(fieldName: string): string | undefined {
            const field = schema.properties?.[fieldName] as JSONSchema | undefined;
            return field?.anyOf && (field.anyOf[0] as JSONSchema | undefined)?.['x-bsonType'];
        }

        expect(getBsonType('int32Field')).toBe('int32');
        expect(getBsonType('doubleField')).toBe('double');
        expect(getBsonType('decimalField')).toBe('decimal128');
        expect(getBsonType('dateField')).toBe('date');
        expect(getBsonType('objectIdField')).toBe('objectid');
        expect(getBsonType('codeField')).toBe('code');
        expect(getBsonType('uuidField')).toBe('uuid');
        expect(getBsonType('uuidLegacyField')).toBe('uuid-legacy');
    });

    it('detects embedded objects correctly', () => {
        const analyzer = SchemaAnalyzer.fromDocument(embeddedDocumentOnly);
        const schema = analyzer.getSchema();

        expect(schema.properties).toHaveProperty('personalInfo');
        expect(schema.properties).toHaveProperty('jobInfo');

        const personalInfoAnyOf = (schema.properties!['personalInfo'] as JSONSchema).anyOf;
        const personalInfoProperties = (personalInfoAnyOf?.[0] as JSONSchema | undefined)?.properties;
        expect(personalInfoProperties).toHaveProperty('name');
        expect(personalInfoProperties).toHaveProperty('age');
        expect(personalInfoProperties).toHaveProperty('married');
        expect(personalInfoProperties).toHaveProperty('address');

        const addressAnyOf = ((personalInfoProperties as JSONSchemaMap)['address'] as JSONSchema).anyOf;
        const addressProperties = (addressAnyOf?.[0] as JSONSchema | undefined)?.properties;
        expect(addressProperties).toHaveProperty('street');
        expect(addressProperties).toHaveProperty('city');
        expect(addressProperties).toHaveProperty('zip');
    });

    it('detects arrays and their element types', () => {
        const analyzer = SchemaAnalyzer.fromDocument(arraysWithDifferentDataTypes);
        const schema = analyzer.getSchema();

        function getArrayItemTypes(fieldName: string): string[] | undefined {
            const field = schema.properties?.[fieldName] as JSONSchema | undefined;
            const itemsAnyOf: JSONSchemaRef[] | undefined = (
                (field?.anyOf?.[0] as JSONSchema | undefined)?.items as JSONSchema | undefined
            )?.anyOf;
            return itemsAnyOf?.map((e) => (e as JSONSchema)['type'] as string);
        }

        expect(getArrayItemTypes('integersArray')).toContain('number');
        expect(getArrayItemTypes('stringsArray')).toContain('string');
        expect(getArrayItemTypes('mixedArray')).toEqual(
            expect.arrayContaining(['number', 'string', 'boolean', 'object', 'null']),
        );
    });

    it('handles arrays within objects and objects within arrays', () => {
        const analyzer = SchemaAnalyzer.fromDocument(complexDocument);
        const schema = analyzer.getSchema();

        // user.profile.hobbies → string elements
        const user = schema.properties?.['user'] as JSONSchema;
        const userProfile = (user?.anyOf?.[0] as JSONSchema)?.properties?.['profile'] as JSONSchema;
        const hobbies = (userProfile?.anyOf?.[0] as JSONSchema)?.properties?.['hobbies'] as JSONSchema;
        const hobbiesItems = (hobbies?.anyOf?.[0] as JSONSchema)?.items as JSONSchema;
        const hobbiesItemTypes = hobbiesItems?.anyOf?.map((e) => (e as JSONSchema).type);
        expect(hobbiesItemTypes).toContain('string');

        // orders is an array of objects with nested items array
        const orders = schema.properties?.['orders'] as JSONSchema;
        expect((orders?.anyOf?.[0] as JSONSchema)?.type).toBe('array');
        const orderItemsParent = (orders?.anyOf?.[0] as JSONSchema)?.items as JSONSchema;
        const orderItems = (orderItemsParent?.anyOf?.[0] as JSONSchema)?.properties?.['items'] as JSONSchema;
        expect((orderItems?.anyOf?.[0] as JSONSchema)?.type).toBe('array');
    });

    it('merges schemas from multiple complex documents', () => {
        const analyzer = SchemaAnalyzer.fromDocuments(complexDocumentsArray);
        const schema = analyzer.getSchema();

        expect(schema['x-documentsInspected']).toBe(complexDocumentsArray.length);
        expect(schema.properties).toHaveProperty('stringField');
        expect(schema.properties).toHaveProperty('personalInfo');
        expect(schema.properties).toHaveProperty('integersArray');
        expect(schema.properties).toHaveProperty('user');

        // integersArray stats
        const integersArray = schema.properties?.['integersArray'] as JSONSchema;
        const intType = ((integersArray?.anyOf?.[0] as JSONSchema)?.items as JSONSchema)?.anyOf?.[0] as JSONSchema;
        expect(intType?.['x-minValue']).toBe(1);
        expect(intType?.['x-maxValue']).toBe(5);

        // orders.items.price is Decimal128
        const orders = schema.properties?.['orders'] as JSONSchema;
        const orderParent = (orders?.anyOf?.[0] as JSONSchema)?.items as JSONSchema;
        const orderItems = (orderParent?.anyOf?.[0] as JSONSchema)?.properties?.['items'] as JSONSchema;
        const priceParent = ((orderItems?.anyOf?.[0] as JSONSchema)?.items as JSONSchema)?.anyOf?.[0] as JSONSchema;
        const priceField = priceParent?.properties?.['price'] as JSONSchema;
        expect((priceField?.anyOf?.[0] as JSONSchema)?.['x-bsonType']).toBe('decimal128');
    });
});

// ── Schema traversal (getPropertyNamesAtLevel) ─────────────────────────

describe('BSON SchemaAnalyzer — schema traversal', () => {
    it('returns property names at each nesting level', () => {
        const analyzer = SchemaAnalyzer.fromDocument(complexDocument);
        const schema = analyzer.getSchema();

        expect(getPropertyNamesAtLevel(schema, [])).toHaveLength(4);
        expect(getPropertyNamesAtLevel(schema, ['user'])).toHaveLength(3);
        expect(getPropertyNamesAtLevel(schema, ['user', 'profile'])).toHaveLength(4);
    });

    it('throws for invalid paths', () => {
        const analyzer = SchemaAnalyzer.fromDocument(complexDocument);
        const schema = analyzer.getSchema();

        expect(() => getPropertyNamesAtLevel(schema, ['no-entry'])).toThrow();
        expect(() => getPropertyNamesAtLevel(schema, ['user', 'no-entry'])).toThrow();
    });

    it('handles sparse docs with mixed types at a path', () => {
        const analyzer = new SchemaAnalyzer();
        analyzer.addDocument(complexDocument);
        analyzer.addDocument(complexDocumentWithOddTypes);
        const schema = analyzer.getSchema();

        expect(getPropertyNamesAtLevel(schema, [])).toHaveLength(4);
        expect(getPropertyNamesAtLevel(schema, ['user'])).toEqual(['email', 'profile', 'username']);
        expect(getPropertyNamesAtLevel(schema, ['user', 'profile'])).toEqual([
            'addresses',
            'firstName',
            'hobbies',
            'lastName',
        ]);
        expect(getPropertyNamesAtLevel(schema, ['history'])).toHaveLength(6);
    });
});

// ── Class methods ──────────────────────────────────────────────────────

describe('BSON SchemaAnalyzer — class methods', () => {
    it('clone() creates an independent deep copy', () => {
        const original = SchemaAnalyzer.fromDocument(embeddedDocumentOnly);
        const cloned = original.clone();

        expect(cloned.getDocumentCount()).toBe(1);
        expect(Object.keys(cloned.getSchema().properties || {})).toEqual(
            Object.keys(original.getSchema().properties || {}),
        );

        original.addDocument(arraysWithDifferentDataTypes);
        expect(original.getDocumentCount()).toBe(2);
        expect(cloned.getDocumentCount()).toBe(1);
        expect(Object.keys(original.getSchema().properties || {})).toContain('integersArray');
        expect(Object.keys(cloned.getSchema().properties || {})).not.toContain('integersArray');
    });

    it('reset() clears all accumulated state', () => {
        const analyzer = SchemaAnalyzer.fromDocument(flatDocument);
        expect(analyzer.getDocumentCount()).toBeGreaterThan(0);

        analyzer.reset();
        expect(analyzer.getDocumentCount()).toBe(0);
        expect(analyzer.getSchema().properties).toBeUndefined();
    });

    it('fromDocument() creates analyzer with a single document', () => {
        const analyzer = SchemaAnalyzer.fromDocument(flatDocument);
        expect(analyzer.getDocumentCount()).toBe(1);
        expect(Object.keys(analyzer.getSchema().properties || {})).toEqual(
            expect.arrayContaining(Object.keys(flatDocument)),
        );
    });

    it('fromDocuments() is equivalent to addDocuments()', () => {
        const analyzer = SchemaAnalyzer.fromDocuments(sparseDocumentsArray);
        const manual = new SchemaAnalyzer();
        manual.addDocuments(sparseDocumentsArray);
        expect(JSON.stringify(analyzer.getSchema())).toBe(JSON.stringify(manual.getSchema()));
    });

    it('addDocuments() is equivalent to sequential addDocument()', () => {
        const batch = new SchemaAnalyzer();
        batch.addDocuments(complexDocumentsArray);

        const sequential = new SchemaAnalyzer();
        for (const doc of complexDocumentsArray) {
            sequential.addDocument(doc);
        }

        expect(batch.getDocumentCount()).toBe(sequential.getDocumentCount());
        expect(JSON.stringify(batch.getSchema())).toBe(JSON.stringify(sequential.getSchema()));
    });
});

// ── Version counter ────────────────────────────────────────────────────

describe('BSON SchemaAnalyzer — version counter', () => {
    it('starts at 0', () => {
        expect(new SchemaAnalyzer().version).toBe(0);
    });

    it('increments on addDocument()', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ a: 1 }));
        expect(a.version).toBe(1);
        a.addDocument(makeDoc({ b: 2 }));
        expect(a.version).toBe(2);
    });

    it('increments once for addDocuments() batch', () => {
        const a = new SchemaAnalyzer();
        a.addDocuments([makeDoc(), makeDoc(), makeDoc()]);
        expect(a.version).toBe(1);
    });

    it('increments on reset()', () => {
        const a = SchemaAnalyzer.fromDocument(makeDoc());
        a.reset();
        expect(a.version).toBe(2);
    });

    it('clone starts with version 0', () => {
        const original = new SchemaAnalyzer();
        original.addDocument(makeDoc());
        original.addDocument(makeDoc());
        const cloned = original.clone();
        expect(cloned.version).toBe(0);
        cloned.addDocument(makeDoc());
        expect(cloned.version).toBe(1);
        expect(original.version).toBe(2);
    });

    it('fromDocument() yields version 1, fromDocuments() yields version 1', () => {
        expect(SchemaAnalyzer.fromDocument(makeDoc()).version).toBe(1);
        expect(SchemaAnalyzer.fromDocuments([makeDoc(), makeDoc()]).version).toBe(1);
    });
});

// ── getKnownFields cache ───────────────────────────────────────────────

describe('BSON SchemaAnalyzer — getKnownFields cache', () => {
    it('populates on first call', () => {
        const a = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice', age: 30 }));
        const fields = a.getKnownFields();
        expect(fields.length).toBeGreaterThan(0);
        expect(fields.map((f) => f.path)).toEqual(expect.arrayContaining(['_id', 'name', 'age']));
    });

    it('returns the same reference when version is unchanged', () => {
        const a = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
        expect(a.getKnownFields()).toBe(a.getKnownFields());
    });

    it('invalidates on addDocument()', () => {
        const a = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
        const before = a.getKnownFields();
        a.addDocument(makeDoc({ email: 'bob@test.com' }));
        const after = a.getKnownFields();
        expect(after).not.toBe(before);
        expect(after.map((f) => f.path)).toContain('email');
    });

    it('invalidates on reset()', () => {
        const a = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
        const before = a.getKnownFields();
        a.reset();
        const after = a.getKnownFields();
        expect(after).not.toBe(before);
        expect(after).toHaveLength(0);
    });

    it('clone gets its own independent cache', () => {
        const original = SchemaAnalyzer.fromDocument(makeDoc({ name: 'Alice' }));
        const originalFields = original.getKnownFields();
        const cloned = original.clone();
        const clonedFields = cloned.getKnownFields();

        expect(clonedFields).not.toBe(originalFields);
        expect(clonedFields.map((f) => f.path)).toEqual(originalFields.map((f) => f.path));

        cloned.addDocument(makeDoc({ extra: true }));
        expect(cloned.getKnownFields().map((f) => f.path)).toContain('extra');
        expect(original.getKnownFields().map((f) => f.path)).not.toContain('extra');
    });
});

// ── Occurrence & type counting ─────────────────────────────────────────

describe('BSON SchemaAnalyzer — occurrence counting', () => {
    it('counts x-occurrence for fields across documents', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ name: 'Alice', age: 30 }));
        a.addDocument(makeDoc({ name: 'Bob', age: 25 }));
        a.addDocument(makeDoc({ name: 'Carol' }));

        const s = a.getSchema();
        expect((s.properties?.['name'] as JSONSchema)['x-occurrence']).toBe(3);
        expect((s.properties?.['age'] as JSONSchema)['x-occurrence']).toBe(2);
    });

    it('counts x-typeOccurrence for polymorphic fields', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ value: 'hello' }));
        a.addDocument(makeDoc({ value: 42 }));
        a.addDocument(makeDoc({ value: 'world' }));
        a.addDocument(makeDoc({ value: true }));

        const s = a.getSchema();
        const valueField = s.properties?.['value'] as JSONSchema;
        const stringEntry = valueField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'string') as JSONSchema;
        const boolEntry = valueField.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'boolean') as JSONSchema;

        expect(stringEntry['x-typeOccurrence']).toBe(2);
        expect(boolEntry['x-typeOccurrence']).toBe(1);

        const totalType = (valueField.anyOf as JSONSchema[]).reduce(
            (sum, e) => sum + ((e['x-typeOccurrence'] as number) ?? 0),
            0,
        );
        expect(valueField['x-occurrence']).toBe(totalType);
    });

    it('counts x-documentsInspected for nested objects', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ info: { x: 1 } }));
        a.addDocument(makeDoc({ info: { x: 2, y: 3 } }));

        const s = a.getSchema();
        const infoObj = (s.properties?.['info'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;
        expect(infoObj['x-documentsInspected']).toBe(2);
    });

    it('counts x-documentsInspected for objects inside arrays', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ items: [{ a: 1 }, { a: 2 }] }));
        a.addDocument(makeDoc({ items: [{ a: 3, b: 4 }] }));

        const s = a.getSchema();
        const arrayEntry = (s.properties?.['items'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'array',
        ) as JSONSchema;
        const objEntry = (arrayEntry.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;

        expect(objEntry['x-documentsInspected']).toBe(3);
        expect((objEntry.properties?.['a'] as JSONSchema)['x-occurrence']).toBe(3);
        expect((objEntry.properties?.['b'] as JSONSchema)['x-occurrence']).toBe(1);
    });

    it('yields 100% probability for fields in every document', () => {
        const a = new SchemaAnalyzer();
        for (let i = 0; i < 10; i++) a.addDocument(makeDoc({ name: `user-${i}` }));

        const s = a.getSchema();
        const occ = (s.properties?.['name'] as JSONSchema)['x-occurrence'] as number;
        const total = s['x-documentsInspected'] as number;
        expect(occ / total).toBe(1);
    });

    it('yields correct fraction for sparse fields', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ a: 1, b: 10 }));
        a.addDocument(makeDoc({ a: 2 }));
        a.addDocument(makeDoc({ a: 3 }));

        const s = a.getSchema();
        const total = s['x-documentsInspected'] as number;
        expect(((s.properties?.['a'] as JSONSchema)['x-occurrence'] as number) / total).toBe(1);
        expect(((s.properties?.['b'] as JSONSchema)['x-occurrence'] as number) / total).toBeCloseTo(1 / 3);
    });
});

// ── Array stats ────────────────────────────────────────────────────────

describe('BSON SchemaAnalyzer — array statistics', () => {
    it('tracks min/max array lengths', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ tags: ['a', 'b', 'c'] }));
        a.addDocument(makeDoc({ tags: ['x'] }));
        a.addDocument(makeDoc({ tags: ['p', 'q', 'r', 's', 't'] }));

        const arr = (a.getSchema().properties?.['tags'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'array',
        ) as JSONSchema;
        expect(arr['x-minItems']).toBe(1);
        expect(arr['x-maxItems']).toBe(5);
    });

    it('counts element types across documents', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ data: ['a', 'b', 'c', { value: 23 }] }));
        a.addDocument(makeDoc({ data: ['x', 'y', { value: 42, flag: true }] }));
        a.addDocument(makeDoc({ data: ['z'] }));

        const s = a.getSchema();
        const arr = (s.properties?.['data'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'array',
        ) as JSONSchema;
        const items = arr.items as JSONSchema;

        const strEntry = items.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'string') as JSONSchema;
        const objEntry = items.anyOf?.find((e) => (e as JSONSchema)['x-bsonType'] === 'object') as JSONSchema;

        expect(strEntry['x-typeOccurrence']).toBe(6);
        expect(objEntry['x-typeOccurrence']).toBe(2);
        expect(objEntry['x-documentsInspected']).toBe(2);
        expect((objEntry.properties?.['value'] as JSONSchema)['x-occurrence']).toBe(2);
        expect((objEntry.properties?.['flag'] as JSONSchema)['x-occurrence']).toBe(1);
    });

    it('preserves global min/max across multiple array instances', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ scores: [10, 20, 30] }));
        a.addDocument(makeDoc({ scores: [5, 15] }));

        const arr = (a.getSchema().properties?.['scores'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'array',
        ) as JSONSchema;
        const numEntry = (arr.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'double',
        ) as JSONSchema;

        expect(numEntry['x-minValue']).toBe(5);
        expect(numEntry['x-maxValue']).toBe(30);
    });

    it('handles the >100% probability edge-case with empty arrays', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(makeDoc({ a: [] }));
        const objects: Record<string, unknown>[] = [];
        for (let i = 1; i <= 100; i++) objects.push({ b: i });
        a.addDocument(makeDoc({ a: objects }));

        const s = a.getSchema();
        const arr = (s.properties?.['a'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'array',
        ) as JSONSchema;
        const objEntry = (arr.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;

        expect(objEntry['x-typeOccurrence']).toBe(100);
        expect(objEntry['x-documentsInspected']).toBe(100);
        expect((objEntry.properties?.['b'] as JSONSchema)['x-occurrence']).toBe(100);
    });

    it('counts nested arrays (arrays within arrays)', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(
            makeDoc({
                matrix: [
                    [1, 2],
                    [3, 4, 5],
                ],
            }),
        );
        a.addDocument(makeDoc({ matrix: [[10]] }));

        const outer = (a.getSchema().properties?.['matrix'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'array',
        ) as JSONSchema;
        expect(outer['x-typeOccurrence']).toBe(2);
        expect(outer['x-minItems']).toBe(1);
        expect(outer['x-maxItems']).toBe(2);

        const inner = (outer.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'array',
        ) as JSONSchema;
        expect(inner['x-typeOccurrence']).toBe(3);
        expect(inner['x-minItems']).toBe(1);
        expect(inner['x-maxItems']).toBe(3);

        const numEntry = (inner.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema).type === 'number',
        ) as JSONSchema;
        expect(numEntry['x-typeOccurrence']).toBe(6);
    });

    it('counts objects within arrays within objects (deep nesting)', () => {
        const a = new SchemaAnalyzer();
        a.addDocument(
            makeDoc({
                company: {
                    departments: [
                        { name: 'Eng', employees: [{ role: 'Dev' }, { role: 'QA', level: 3 }] },
                        { name: 'Sales' },
                    ],
                },
            }),
        );
        a.addDocument(
            makeDoc({
                company: {
                    departments: [{ name: 'HR', employees: [{ role: 'Recruiter' }] }],
                },
            }),
        );

        const s = a.getSchema();
        const companyObj = (s.properties?.['company'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;
        expect(companyObj['x-documentsInspected']).toBe(2);

        const deptArr = (companyObj.properties?.['departments'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'array',
        ) as JSONSchema;
        const deptObj = (deptArr.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;
        expect(deptObj['x-documentsInspected']).toBe(3);
        expect((deptObj.properties?.['name'] as JSONSchema)['x-occurrence']).toBe(3);
        expect((deptObj.properties?.['employees'] as JSONSchema)['x-occurrence']).toBe(2);

        const empArr = (deptObj.properties?.['employees'] as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'array',
        ) as JSONSchema;
        const empObj = (empArr.items as JSONSchema).anyOf?.find(
            (e) => (e as JSONSchema)['x-bsonType'] === 'object',
        ) as JSONSchema;
        expect(empObj['x-documentsInspected']).toBe(3);
        expect((empObj.properties?.['role'] as JSONSchema)['x-occurrence']).toBe(3);
        expect((empObj.properties?.['level'] as JSONSchema)['x-occurrence']).toBe(1);
    });
});
