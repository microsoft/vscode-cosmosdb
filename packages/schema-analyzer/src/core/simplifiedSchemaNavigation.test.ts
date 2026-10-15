/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { SchemaAnalyzer } from '../bson/index.js';
import { getKnownFields, getPropertyNamesAtLevel, getSchemaAtPath, simplifySchema, type JSONSchema } from '../index.js';
import { getSchemaFromDocument, getSchemaFromDocuments, updateSchemaWithDocument } from '../json/index.js';

function expandedJson(documents: Record<string, unknown>[]): JSONSchema {
    const schema = getSchemaFromDocument(documents[0]);
    for (const document of documents.slice(1)) {
        updateSchemaWithDocument(schema, document);
    }
    return schema;
}

describe.each([
    { name: 'expanded JSON', create: expandedJson, typeKey: 'x-dataType', numberType: 'number' },
    {
        name: 'explicitly simplified JSON',
        create: (documents: Record<string, unknown>[]) => {
            const schema = expandedJson(documents);
            simplifySchema(schema);
            return schema;
        },
        typeKey: 'x-dataType',
        numberType: 'number',
    },
    { name: 'batch JSON', create: getSchemaFromDocuments, typeKey: 'x-dataType', numberType: 'number' },
    {
        name: 'expanded BSON',
        create: (documents: Record<string, unknown>[]) => SchemaAnalyzer.fromDocuments(documents).getSchema(),
        typeKey: 'x-bsonType',
        numberType: 'double',
    },
    {
        name: 'simplified BSON',
        create: (documents: Record<string, unknown>[]) => {
            const schema = SchemaAnalyzer.fromDocuments(documents).getSchema();
            simplifySchema(schema);
            return schema;
        },
        typeKey: 'x-bsonType',
        numberType: 'double',
    },
])('$name navigation', ({ create, typeKey, numberType }) => {
    it('selects the requested nested object rather than its parent, without mutating the schema', () => {
        const schema = create([{ user: { profile: { name: 'Ada', _id: 1, age: 30 } }, rootOnly: true }]);
        const before = structuredClone(schema);

        expect(getSchemaAtPath(schema, [])).toBe(schema);
        expect(getPropertyNamesAtLevel(schema, [])).toEqual(['rootOnly', 'user']);
        expect(getPropertyNamesAtLevel(schema, ['user'])).toEqual(['profile']);
        expect(getPropertyNamesAtLevel(schema, ['user', 'profile'])).toEqual(['_id', 'age', 'name']);
        expect(getSchemaAtPath(schema, ['user', 'profile'])).toMatchObject({
            type: 'object',
            properties: { name: expect.any(Object), age: expect.any(Object), _id: expect.any(Object) },
        });
        expect(schema).toEqual(before);
    });

    it('traverses object variants in array items and nested arrays without index path segments', () => {
        const schema = create([
            {
                rows: [null, { profile: { name: 'Ada' }, nested: [[{ detail: { label: true } }]] }],
                matrix: [[{ cell: { value: 1 } }], []],
            },
        ]);

        expect(getPropertyNamesAtLevel(schema, ['rows'])).toEqual(['nested', 'profile']);
        expect(getPropertyNamesAtLevel(schema, ['rows', 'profile'])).toEqual(['name']);
        expect(getPropertyNamesAtLevel(schema, ['rows', 'nested', 'detail'])).toEqual(['label']);
        expect(getPropertyNamesAtLevel(schema, ['matrix', 'cell'])).toEqual(['value']);
        expect(getSchemaAtPath(schema, ['rows', 'profile'])).toMatchObject({ type: 'object' });
    });

    it('searches all object and array variants for a complete path and combines their property names', () => {
        const schema = create([
            { mixed: [{ shared: { arrayOnly: 1 }, arrayBranch: { leaf: true } }] },
            { mixed: null },
            { mixed: { shared: { objectOnly: 2 }, objectBranch: { leaf: false } } },
        ]);

        expect(getPropertyNamesAtLevel(schema, ['mixed'])).toEqual(['arrayBranch', 'objectBranch', 'shared']);
        expect(getPropertyNamesAtLevel(schema, ['mixed', 'shared'])).toEqual(['arrayOnly', 'objectOnly']);
        expect(getPropertyNamesAtLevel(schema, ['mixed', 'arrayBranch'])).toEqual(['leaf']);
        expect(getPropertyNamesAtLevel(schema, ['mixed', 'objectBranch'])).toEqual(['leaf']);
        expect(getSchemaAtPath(schema, ['mixed', 'arrayBranch'])).toMatchObject({
            type: 'object',
            properties: { leaf: expect.any(Object) },
        });
        // The singular accessor prefers a direct object over an object reached through array items.
        expect(Object.keys(getSchemaAtPath(schema, ['mixed'])!.properties!)).toEqual(['shared', 'objectBranch']);
        expect(Object.keys(getSchemaAtPath(schema, ['mixed', 'shared'])!.properties!)).toEqual(['objectOnly']);
    });

    it.each([false, true])(
        'prefers direct targets across all parent variants (reverse document order: %s)',
        (reverse) => {
            const documents = [
                { mixed: { target: [{ arrayOnly: { leaf: true } }] } },
                { mixed: [{ target: { directOnly: { leaf: false } } }] },
            ];
            const schema = create(reverse ? documents.toReversed() : documents);
            const before = structuredClone(schema);

            expect(Object.keys(getSchemaAtPath(schema, ['mixed', 'target'])!.properties!)).toEqual(['directOnly']);
            expect(getPropertyNamesAtLevel(schema, ['mixed', 'target'])).toEqual(['arrayOnly', 'directOnly']);
            expect(getPropertyNamesAtLevel(schema, ['mixed', 'target', 'arrayOnly'])).toEqual(['leaf']);
            expect(getSchemaAtPath(schema, ['mixed', 'target', 'arrayOnly'])).toMatchObject({
                type: 'object',
                properties: { leaf: expect.any(Object) },
            });
            expect(schema).toEqual(before);
        },
    );

    it.each([false, true])(
        'prefers shallower array targets across all parent variants (reverse document order: %s)',
        (reverse) => {
            const documents = [
                { mixed: { target: [[{ deepOnly: true }]] } },
                { mixed: [{ target: [{ shallowOnly: false }] }] },
            ];
            const schema = create(reverse ? documents.toReversed() : documents);

            expect(Object.keys(getSchemaAtPath(schema, ['mixed', 'target'])!.properties!)).toEqual(['shallowOnly']);
            expect(getPropertyNamesAtLevel(schema, ['mixed', 'target'])).toEqual(['deepOnly', 'shallowOnly']);
        },
    );

    it('returns no object for terminal scalar or empty-array paths and retains useful missing-path errors', () => {
        const schema = create([{ user: { scalar: 1 }, empty: [], scalars: ['text'], matrix: [[]] }]);
        for (const path of [['user', 'scalar'], ['empty'], ['scalars'], ['matrix']]) {
            expect(getSchemaAtPath(schema, path)).toBeUndefined();
            expect(getPropertyNamesAtLevel(schema, path)).toEqual([]);
        }
        for (const path of [
            ['missing'],
            ['user', 'missing'],
            ['user', 'scalar', 'child'],
            ['empty', 'child'],
            ['scalars', 'child'],
            ['matrix', 'child'],
        ]) {
            const error = `No properties found in the schema at path "${path.join('/')}"`;
            expect(() => getSchemaAtPath(schema, path)).toThrow(error);
            expect(() => getPropertyNamesAtLevel(schema, path)).toThrow(error);
        }
    });

    it('does not resolve inherited names as schema properties', () => {
        const schema = create([{ user: { name: 'Ada' } }]);
        expect(() => getPropertyNamesAtLevel(schema, ['user', 'constructor'])).toThrow(
            'No properties found in the schema at path "user/constructor"',
        );
    });

    it('reports dominant array element types for single types, unions, objects, nested arrays and empty items', () => {
        const schema = create([
            {
                single: [1, 2],
                mixed: [1, 'a', 'b'],
                objects: [{ name: 'Ada' }],
                nested: [[1]],
                empty: [],
                user: { tags: ['a'] },
            },
        ]);
        expect(getKnownFields(schema, typeKey)).toEqual([
            { path: 'empty', type: 'array', dataType: 'array' },
            { path: 'mixed', type: 'array', dataType: 'array', arrayItemDataType: 'string' },
            { path: 'nested', type: 'array', dataType: 'array', arrayItemDataType: 'array' },
            { path: 'objects', type: 'array', dataType: 'array', arrayItemDataType: 'object' },
            { path: 'single', type: 'array', dataType: 'array', arrayItemDataType: numberType },
            { path: 'user.tags', type: 'array', dataType: 'array', arrayItemDataType: 'string' },
        ]);
    });
});
