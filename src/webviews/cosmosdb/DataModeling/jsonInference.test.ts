/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { inferSchemaFromJson } from './jsonInference';

describe('inferSchemaFromJson', () => {
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
                { name: 'items/product', type: 'object', role: 'payload', pkCandidate: false },
                { name: 'items/product/sku', type: 'string', role: 'payload', pkCandidate: false },
                { name: 'items/product/name', type: 'string', role: 'payload', pkCandidate: false },
                { name: 'items/quantity', type: 'number', role: 'payload', pkCandidate: false },
            ]),
        );
    });
});
