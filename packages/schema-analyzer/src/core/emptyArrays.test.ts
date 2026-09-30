/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { SchemaAnalyzer } from '../bson/index.js';
import { getKnownFields, simplifySchema, type JSONSchema, type JSONSchemaRef } from '../index.js';
import { getSchemaFromDocument, getSchemaFromDocuments, updateSchemaWithDocument } from '../json/index.js';

function collectUnionSizes(schema: JSONSchemaRef): number[] {
    if (typeof schema === 'boolean') return [];
    const sizes: number[] = [];
    if (schema.anyOf) {
        sizes.push(schema.anyOf.length, ...schema.anyOf.flatMap(collectUnionSizes));
    }
    sizes.push(...Object.values(schema.properties ?? {}).flatMap(collectUnionSizes));
    if (schema.items !== undefined) {
        const items = Array.isArray(schema.items) ? schema.items : [schema.items];
        sizes.push(...items.flatMap(collectUnionSizes));
    }
    return sizes;
}

function arrayEntry(schema: JSONSchema): JSONSchema {
    return (schema.properties!['values'] as JSONSchema).anyOf![0] as JSONSchema;
}

describe.each([
    {
        name: 'JSON',
        numberType: 'number',
        typeKey: 'x-dataType',
        batch: getSchemaFromDocuments,
        create: (document: Record<string, unknown>) => {
            const schema = getSchemaFromDocument(document);
            return {
                getSchema: () => schema,
                addDocument: (next: Record<string, unknown>) => updateSchemaWithDocument(schema, next),
                getKnownFields: () => getKnownFields(schema, 'x-dataType'),
            };
        },
    },
    {
        name: 'BSON',
        numberType: 'double',
        typeKey: 'x-bsonType',
        batch: (documents: Record<string, unknown>[]) => SchemaAnalyzer.fromDocuments(documents).getSchema(),
        create: (document: Record<string, unknown>) => SchemaAnalyzer.fromDocument(document),
    },
])('$name empty arrays', ({ create, batch, numberType, typeKey }) => {
    it('leaves item types unconstrained until an element is observed', () => {
        const schema = create({ values: [] }).getSchema();
        expect(arrayEntry(schema).items).toEqual({});
        expect(arrayEntry(schema)).toMatchObject({ type: 'array', 'x-minItems': 0, 'x-maxItems': 0 });
    });

    it.each([
        { name: 'root field', document: { values: [] } },
        { name: 'nested object', document: { parent: { values: [] } } },
        { name: 'nested arrays', document: { values: [[], [[]]] } },
        { name: 'objects inside arrays', document: { values: [{ children: [] }, { children: [[]] }] } },
        { name: 'mixed array elements', document: { values: [[], 1, 'text', { children: [] }] } },
    ])('does not emit empty unions for $name, including batch and simplified output', ({ document }) => {
        const schema = create(document).getSchema();
        expect(collectUnionSizes(schema)).not.toContain(0);
        simplifySchema(schema);
        expect(collectUnionSizes(schema)).not.toContain(0);
        expect(collectUnionSizes(batch([document, document]))).not.toContain(0);
    });

    it('preserves empty items and counts across repeated empty observations', () => {
        const analyzer = create({ values: [] });
        analyzer.addDocument({ values: [] });
        expect(arrayEntry(analyzer.getSchema())).toMatchObject({
            items: {},
            'x-typeOccurrence': 2,
            'x-minItems': 0,
            'x-maxItems': 0,
        });
        expect(arrayEntry(analyzer.getSchema()).items).toEqual({});
        expect(analyzer.getSchema()['x-documentsInspected']).toBe(2);
    });

    it.each([
        { name: 'empty first', arrays: [[], [1, 'text', 3], [], [5]] },
        { name: 'populated first', arrays: [[1, 'text', 3], [], [5], []] },
    ])('learns element types without losing statistics: $name', ({ arrays }) => {
        const analyzer = create({ values: arrays[0] });
        for (const values of arrays.slice(1)) {
            analyzer.addDocument({ values });
            expect(collectUnionSizes(analyzer.getSchema())).not.toContain(0);
        }

        const schema = analyzer.getSchema();
        const array = arrayEntry(schema);
        expect(schema['x-documentsInspected']).toBe(4);
        expect(schema.properties!['values']).toMatchObject({ 'x-occurrence': 4 });
        expect(array).toMatchObject({ 'x-typeOccurrence': 4, 'x-minItems': 0, 'x-maxItems': 3 });
        expect((array.items as JSONSchema).anyOf).toEqual([
            expect.objectContaining({
                [typeKey]: numberType,
                'x-typeOccurrence': 3,
                'x-minValue': 1,
                'x-maxValue': 5,
            }),
            expect.objectContaining({
                [typeKey]: 'string',
                'x-typeOccurrence': 1,
                'x-minLength': 4,
                'x-maxLength': 4,
            }),
        ]);

        const batchSchema = batch(arrays.map((values) => ({ values })));
        simplifySchema(schema);
        simplifySchema(batchSchema);
        expect(schema).toEqual(batchSchema);
    });

    it('learns types inside previously empty nested arrays', () => {
        const analyzer = create({ values: [[], []] });
        expect(collectUnionSizes(analyzer.getSchema())).not.toContain(0);
        analyzer.addDocument({ values: [[2], []] });
        const outer = arrayEntry(analyzer.getSchema());
        const inner = (outer.items as JSONSchema).anyOf![0] as JSONSchema;
        expect(inner).toMatchObject({ type: 'array', 'x-typeOccurrence': 4, 'x-minItems': 0, 'x-maxItems': 1 });
        expect((inner.items as JSONSchema).anyOf).toEqual([
            expect.objectContaining({ [typeKey]: numberType, 'x-typeOccurrence': 1, 'x-minValue': 2, 'x-maxValue': 2 }),
        ]);
    });

    it('reports an unknown element type until values arrive, then updates the field list', () => {
        const analyzer = create({ values: [] });
        expect(analyzer.getKnownFields()).toEqual([{ path: 'values', type: 'array', dataType: 'array' }]);
        analyzer.addDocument({ values: [42] });
        expect(analyzer.getKnownFields()).toEqual([
            { path: 'values', type: 'array', dataType: 'array', arrayItemDataType: numberType },
        ]);
    });
});
