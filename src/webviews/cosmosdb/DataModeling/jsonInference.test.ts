/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DocumentSizeLimitError, inferSchemaFromJson } from './jsonInference';

describe('inferSchemaFromJson', () => {
    it('keeps array descendants in the schema without preferring their IDs as partition keys', () => {
        const schema = inferSchemaFromJson(
            JSON.stringify([
                { id: 'order-1', items: [{ productId: 'p1' }] },
                { id: 'order-2', items: [{ productId: 'p2' }, { productId: 'p3' }] },
                { id: 'order-3', items: [] },
            ]),
        );

        expect(schema.partitionKey).toBe('/id');
        expect(schema.properties.find((property) => property.name === 'items/productId')).toMatchObject({
            type: 'string',
            hasArrayAncestor: true,
            pkCandidate: false,
        });
        expect(schema.properties.filter((property) => property.pkCandidate).map((property) => property.name)).toEqual([
            'id',
        ]);
    });

    it.each([{ customerId: {} }, { customerId: [] }, { customerId: ['customer-1'] }])(
        'does not prefer an object or array-valued ID: %j',
        (fields) => {
            const schema = inferSchemaFromJson(JSON.stringify({ ...fields, id: 'order-1' }));
            expect(schema.partitionKey).toBe('/id');
        },
    );

    it('does not invent a default when every property is unusable', () => {
        const schema = inferSchemaFromJson(JSON.stringify({ items: [{ productId: 'p1' }] }));
        expect(schema.partitionKey).toBe('');
        expect(schema.properties.every((property) => !property.pkCandidate)).toBe(true);
    });

    it('preserves array ancestry through nested objects and nested arrays', () => {
        const schema = inferSchemaFromJson(
            JSON.stringify({ id: 'order-1', items: [[{ product: { productId: 'p1' } }]] }),
        );
        expect(schema.partitionKey).toBe('/id');
        expect(schema.properties.find((property) => property.name === 'items/product/productId')).toMatchObject({
            hasArrayAncestor: true,
            pkCandidate: false,
        });
    });

    it('excludes mixed scalar/object/array fields even when the scalar type is dominant', () => {
        const schema = inferSchemaFromJson(
            JSON.stringify([
                { id: '1', customerId: 'customer-1' },
                { id: '2', customerId: 'customer-2' },
                { id: '3', customerId: 'customer-3' },
                { id: '4', customerId: { value: 'customer-4' } },
                { id: '5', customerId: ['customer-5'] },
            ]),
        );
        expect(schema.partitionKey).toBe('/id');
        expect(schema.properties.find((property) => property.name === 'customerId')).toMatchObject({
            type: 'string',
            hasNonScalarValues: true,
            pkCandidate: false,
        });
    });

    it('merges object and array descendants without losing the array restriction', () => {
        const documents = [
            { id: 'order-1', items: { productId: 'p1' } },
            { id: 'order-2', items: [{ productId: 'p2' }] },
        ];
        for (const input of [documents, [...documents].reverse()]) {
            const schema = inferSchemaFromJson(JSON.stringify(input));
            expect(schema.partitionKey).toBe('/id');
            expect(schema.properties.filter((property) => property.name === 'items/productId')).toEqual([
                expect.objectContaining({ hasArrayAncestor: true, pkCandidate: false }),
            ]);
        }
    });

    it('accepts a document exactly 2 MB in size', () => {
        const overhead = JSON.stringify({ payload: '' }).length;
        const document = { payload: 'x'.repeat(2 * 1024 * 1024 - overhead) };
        expect(inferSchemaFromJson(JSON.stringify(document)).document).toEqual({
            attributeCount: 1,
            avgSizeKb: 2048,
            maxSizeKb: 2048,
        });
    });

    it('rejects a document one byte above 2 MB before rounding its size', () => {
        const overhead = JSON.stringify({ payload: '' }).length;
        const document = { payload: 'x'.repeat(2 * 1024 * 1024 - overhead + 1) };
        expect(() => inferSchemaFromJson(JSON.stringify(document))).toThrow(DocumentSizeLimitError);
        expect(() => inferSchemaFromJson(JSON.stringify([{ payload: '' }, document]))).toThrow(DocumentSizeLimitError);
    });

    it('measures imported document size in UTF-8 bytes rather than characters', () => {
        const document = { payload: '\u00e9'.repeat(1024 * 1024) };
        expect(() => inferSchemaFromJson(JSON.stringify(document))).toThrow(DocumentSizeLimitError);
    });

    it('uses the shared schema analyzer to include top-level and nested object properties', () => {
        const schema = inferSchemaFromJson(
            JSON.stringify({
                id: 'order-1',
                customer: {
                    customerId: 'customer-1',
                    address: { city: 'Seattle' },
                },
            }),
        );

        expect(schema.properties).toEqual(
            expect.arrayContaining([
                { name: 'id', type: 'string', role: 'key', pkCandidate: false },
                { name: 'customer', type: 'object', role: 'payload', pkCandidate: false },
                { name: 'customer/customerId', type: 'string', role: 'key', pkCandidate: true },
                { name: 'customer/address', type: 'object', role: 'payload', pkCandidate: false },
                { name: 'customer/address/city', type: 'string', role: 'payload', pkCandidate: false },
            ]),
        );
        expect(schema.partitionKey).toBe('/customer/customerId');
        expect(schema.document).toEqual({
            attributeCount: 5,
            avgSizeKb: 0.08,
            maxSizeKb: 0.08,
        });
        expect(schema.hasNestedCollections).toBe(true);
    });

    it('includes nested properties from object array elements across every document', () => {
        const schema = inferSchemaFromJson(
            JSON.stringify([
                { id: 'order-1', items: [{ product: { sku: 'a' }, quantity: 1 }] },
                { id: 'order-2', items: [{ product: { name: 'Widget' }, quantity: 2 }] },
            ]),
        );

        expect(schema.properties).toEqual(
            expect.arrayContaining([
                { name: 'items', type: 'array', role: 'payload', pkCandidate: false },
                { name: 'items/product', type: 'object', role: 'payload', pkCandidate: false, hasArrayAncestor: true },
                {
                    name: 'items/product/sku',
                    type: 'string',
                    role: 'payload',
                    pkCandidate: false,
                    hasArrayAncestor: true,
                },
                {
                    name: 'items/product/name',
                    type: 'string',
                    role: 'payload',
                    pkCandidate: false,
                    hasArrayAncestor: true,
                },
                { name: 'items/quantity', type: 'number', role: 'payload', pkCandidate: false, hasArrayAncestor: true },
            ]),
        );
        expect(schema.document).toEqual({
            attributeCount: 6,
            avgSizeKb: 0.06,
            maxSizeKb: 0.07,
        });
        expect(schema.hasNestedCollections).toBe(true);
    });

    it('does not mark flat documents as containing nested collections', () => {
        const schema = inferSchemaFromJson(JSON.stringify({ id: 'customer-1', name: 'Ada' }));

        expect(schema.hasNestedCollections).toBe(false);
    });
});
