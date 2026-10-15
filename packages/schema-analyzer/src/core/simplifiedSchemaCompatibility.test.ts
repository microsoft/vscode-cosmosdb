/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getKnownFields, simplifySchema, type JSONSchema, type JSONSchemaRef } from '../index.js';
import { getSchemaFromDocument, getSchemaFromDocuments, updateSchemaWithDocument } from '../json/index.js';

function expectValidUnions(schema: JSONSchemaRef): void {
    if (typeof schema === 'boolean') return;
    expect(schema.anyOf && schema.type).toBeUndefined();
    expect(schema.anyOf?.length).not.toBe(0);
    schema.anyOf?.forEach(expectValidUnions);
    Object.values(schema.properties ?? {}).forEach(expectValidUnions);
    if (schema.items !== undefined) {
        const items = Array.isArray(schema.items) ? schema.items : [schema.items];
        items.forEach(expectValidUnions);
    }
}

describe('updating analyzer-produced simplified schemas', () => {
    it.each([
        {
            name: 'automatic batch simplification',
            create: () => getSchemaFromDocuments([{ value: 1 }]),
        },
        {
            name: 'explicit simplification',
            create: () => {
                const schema = getSchemaFromDocument({ value: 1 });
                simplifySchema(schema);
                return schema;
            },
        },
    ])('preserves the original numeric variant when adding a string after $name', ({ create }) => {
        const schema = create();
        expect(schema.properties!['value']).toMatchObject({ type: 'number' });

        updateSchemaWithDocument(schema, { value: 'text' });

        expect(schema.properties!['value']).toEqual({
            'x-occurrence': 2,
            anyOf: [
                {
                    type: 'number',
                    'x-dataType': 'number',
                    'x-typeOccurrence': 1,
                    'x-minValue': 1,
                    'x-maxValue': 1,
                },
                {
                    type: 'string',
                    'x-dataType': 'string',
                    'x-typeOccurrence': 1,
                    'x-minLength': 4,
                    'x-maxLength': 4,
                },
            ],
        } satisfies JSONSchema);
        expect(schema['x-documentsInspected']).toBe(2);
    });

    it('aggregates same-type statistics and property occurrences across repeated simplification', () => {
        const schema = getSchemaFromDocuments([{ number: 4, string: 'four', boolean: true, nil: null }]);
        for (const document of [
            { number: -2, string: 'x', boolean: false, nil: null },
            {},
            { number: 10, string: 'longer', boolean: true, nil: null },
        ]) {
            updateSchemaWithDocument(schema, document);
            expectValidUnions(schema);
            simplifySchema(schema);
        }

        expect(schema['x-documentsInspected']).toBe(4);
        expect(schema.properties).toMatchObject({
            number: { type: 'number', 'x-occurrence': 3, 'x-typeOccurrence': 3, 'x-minValue': -2, 'x-maxValue': 10 },
            string: { type: 'string', 'x-occurrence': 3, 'x-typeOccurrence': 3, 'x-minLength': 1, 'x-maxLength': 6 },
            boolean: { type: 'boolean', 'x-occurrence': 3, 'x-typeOccurrence': 3, 'x-trueCount': 2, 'x-falseCount': 1 },
            nil: { type: 'null', 'x-occurrence': 3, 'x-typeOccurrence': 3 },
        });
    });

    it('moves type keywords and unknown extensions with the original variant, not property occurrences', () => {
        const schema = getSchemaFromDocuments([{ value: 4 }]);
        const value = schema.properties!['value'] as JSONSchema & { 'x-vendorStats': { count: number } };
        value.minimum = 0;
        value.maximum = 10;
        value.enum = [4, 8];
        value['x-vendorStats'] = { count: 1 };

        updateSchemaWithDocument(schema, { value: 'text' });

        expect(Object.keys(value).sort()).toEqual(['anyOf', 'x-occurrence']);
        expect(value.anyOf![0]).toEqual({
            type: 'number',
            'x-dataType': 'number',
            'x-typeOccurrence': 1,
            'x-minValue': 4,
            'x-maxValue': 4,
            minimum: 0,
            maximum: 10,
            enum: [4, 8],
            'x-vendorStats': { count: 1 },
        });
        expect(value.anyOf![1]).not.toHaveProperty('x-vendorStats');
    });

    it('distinguishes data types even when they share a JSON Schema type', () => {
        const schema = getSchemaFromDocuments([{ value: undefined, values: [undefined] }]);
        updateSchemaWithDocument(schema, { value: null, values: [null, undefined] });
        simplifySchema(schema);

        const value = schema.properties!['value'] as JSONSchema;
        expect(value['x-occurrence']).toBe(2);
        expect(value.anyOf).toEqual([
            { type: 'null', 'x-dataType': 'undefined', 'x-typeOccurrence': 1 },
            { type: 'null', 'x-dataType': 'null', 'x-typeOccurrence': 1 },
        ]);
        expect(((schema.properties!['values'] as JSONSchema).items as JSONSchema).anyOf).toEqual([
            { type: 'null', 'x-dataType': 'undefined', 'x-typeOccurrence': 2 },
            { type: 'null', 'x-dataType': 'null', 'x-typeOccurrence': 1 },
        ]);
        expectValidUnions(schema);
    });

    it('preserves simplified item statistics when adding existing and new element types', () => {
        const schema = getSchemaFromDocuments([{ values: [2, 4] }]);
        updateSchemaWithDocument(schema, { values: [8, 'text', false, true] });
        simplifySchema(schema);

        expect(schema.properties!['values']).toEqual({
            type: 'array',
            'x-dataType': 'array',
            'x-occurrence': 2,
            'x-typeOccurrence': 2,
            'x-minItems': 2,
            'x-maxItems': 4,
            items: {
                anyOf: [
                    {
                        type: 'number',
                        'x-dataType': 'number',
                        'x-typeOccurrence': 3,
                        'x-minValue': 2,
                        'x-maxValue': 8,
                    },
                    {
                        type: 'string',
                        'x-dataType': 'string',
                        'x-typeOccurrence': 1,
                        'x-minLength': 4,
                        'x-maxLength': 4,
                    },
                    {
                        type: 'boolean',
                        'x-dataType': 'boolean',
                        'x-typeOccurrence': 2,
                        'x-trueCount': 1,
                        'x-falseCount': 1,
                    },
                ],
            },
        } satisfies JSONSchema);
        expectValidUnions(schema);
    });

    it('keeps empty items unconstrained and learns nested array elements after simplification', () => {
        const schema = getSchemaFromDocuments([{ values: [] }]);
        expect((schema.properties!['values'] as JSONSchema).items).toEqual({});
        for (const values of [[], [[]], [[2]], [], [[4, 'text'], []]]) {
            updateSchemaWithDocument(schema, { values });
            expectValidUnions(schema);
            simplifySchema(schema);
        }

        const outer = schema.properties!['values'] as JSONSchema;
        const inner = outer.items as JSONSchema;
        expect(outer).toMatchObject({ 'x-occurrence': 6, 'x-typeOccurrence': 6, 'x-minItems': 0, 'x-maxItems': 2 });
        expect(inner).toMatchObject({ type: 'array', 'x-typeOccurrence': 4, 'x-minItems': 0, 'x-maxItems': 2 });
        expect(inner['x-occurrence']).toBeUndefined();
        expect((inner.items as JSONSchema).anyOf).toEqual([
            {
                type: 'number',
                'x-dataType': 'number',
                'x-typeOccurrence': 2,
                'x-minValue': 2,
                'x-maxValue': 4,
            },
            {
                type: 'string',
                'x-dataType': 'string',
                'x-typeOccurrence': 1,
                'x-minLength': 4,
                'x-maxLength': 4,
            },
        ]);
    });

    it('leaves items empty through repeated empty updates and simplification', () => {
        const schema = getSchemaFromDocuments([{ values: [] }]);
        for (let count = 2; count <= 4; count++) {
            updateSchemaWithDocument(schema, { values: [] });
            simplifySchema(schema);
            expect(schema.properties!['values']).toMatchObject({
                'x-occurrence': count,
                'x-typeOccurrence': count,
                'x-minItems': 0,
                'x-maxItems': 0,
                items: {},
            });
            expect((schema.properties!['values'] as JSONSchema).items).toEqual({});
            expectValidUnions(schema);
        }
    });

    it('keeps field dominance and sparsity consistent before and after updating simplified output', () => {
        const schema = getSchemaFromDocuments([{ value: 1, values: [1, 2, 3] }, { value: 2 }]);
        updateSchemaWithDocument(schema, { value: 'text', values: ['text'] });
        const expected = [
            { path: 'value', type: 'number', dataType: 'number', dataTypes: ['number', 'string'] },
            { path: 'values', type: 'array', dataType: 'array', arrayItemDataType: 'number', isSparse: true },
        ];
        expect(getKnownFields(schema, 'x-dataType')).toEqual(expected);
        simplifySchema(schema);
        expect(getKnownFields(schema, 'x-dataType')).toEqual(expected);
    });

    const documents = [
        { user: { score: 1, groups: [{ values: [2], active: true }] }, values: [] },
        { user: { score: 8, groups: [{ values: [], active: false }, { values: [4, 'x'] }] }, values: [[]] },
        { user: { score: 'text', groups: [null, { values: [[3]], extra: 'new' }] }, values: [[2], { id: 1 }] },
        { user: null, values: [{ id: 'two', tags: [] }, [false, 4]] },
        {},
        { user: { groups: [{ values: [9], active: true }] }, values: [] },
    ];

    it.each([1, 2, 3, 4, 5])('matches batch output when incrementally continuing a batch of %i documents', (split) => {
        const schema = getSchemaFromDocuments(documents.slice(0, split));
        const expanded = getSchemaFromDocument(documents[0]);
        for (const document of documents.slice(1)) {
            updateSchemaWithDocument(expanded, document);
        }
        for (const document of documents.slice(split)) {
            simplifySchema(schema);
            updateSchemaWithDocument(schema, document);
            expectValidUnions(schema);
        }
        simplifySchema(schema);
        simplifySchema(expanded);
        expect(schema).toEqual(getSchemaFromDocuments(documents));
        expect(schema).toEqual(expanded);
    });

    it('updates a serialized simplified schema without losing nested object observations', () => {
        const initial = getSchemaFromDocuments([{ user: { name: 'first' }, values: [{ score: 1 }] }]);
        const restored = JSON.parse(JSON.stringify(initial)) as JSONSchema;
        updateSchemaWithDocument(restored, { user: { name: 'second', enabled: true }, values: [{ score: 4 }, {}] });
        simplifySchema(restored);
        expect(restored.properties!['user']).toMatchObject({
            'x-typeOccurrence': 2,
            'x-minProperties': 1,
            'x-maxProperties': 2,
            properties: { name: { 'x-occurrence': 2, 'x-typeOccurrence': 2, 'x-minLength': 5, 'x-maxLength': 6 } },
        });
        expect((restored.properties!['values'] as JSONSchema).items).toMatchObject({
            type: 'object',
            'x-typeOccurrence': 3,
            'x-minProperties': 0,
            'x-maxProperties': 1,
            properties: { score: { 'x-occurrence': 2, 'x-typeOccurrence': 2, 'x-minValue': 1, 'x-maxValue': 4 } },
        });
    });
});
