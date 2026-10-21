/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { DATA_MODEL_DEFAULTS } from './dataModelDefaults';
import { queryPropertyNames, readFilterProperties } from './queryFilterProperties';

describe('query property references', () => {
    it.each([
        ['SELECT c.id FROM c WHERE tenantId = @tenantId ORDER BY c.createdAt', ['id', 'tenantId', 'createdAt']],
        ['SELECT * FROM c WHERE c["tenant-id"] = @value', ['tenant-id']],
        ["SELECT * FROM c WHERE c['tenantId'] = 'id'", ['tenantId']],
        ['SELECT * FROM c WHERE c.tenantId = @id /* createdAt */ -- payload', ['tenantId']],
        ['SELECT "id" AS tenantId FROM c', []],
        ['SELECT c.tenantId FROM c', ['tenantId']],
        ['SELECT * FROM c WHERE c.customer.customerId = @customerId', ['customer/customerId']],
        ['SELECT * FROM c WHERE c["customer"]["customerId"] = @customerId', ['customer/customerId']],
        ["SELECT * FROM c WHERE c['customer']['customerId'] = @customerId", ['customer/customerId']],
        ['SELECT * FROM c WHERE c.customer["customerId"] = @customerId', ['customer/customerId']],
        ['SELECT * FROM c WHERE c["customer"].customerId = @customerId', ['customer/customerId']],
        ['SELECT customer.customerId FROM c', ['customer/customerId']],
        ['SELECT doc.customer.customerId FROM Orders AS doc', ['customer/customerId']],
        ['SELECT * FROM c JOIN i IN c.items WHERE i.productId = @p', ['items/productId']],
        ['SELECT i.productId, c.productId FROM c JOIN i IN c.items', ['items/productId', 'productId']],
        ['SELECT i["productId"] FROM c JOIN i IN c["items"]', ['items/productId']],
        ['SELECT i.productId FROM Orders AS doc JOIN i IN doc.orders.items', ['orders/items/productId']],
        ['SELECT i.productId FROM i IN c.items', ['items/productId']],
        ['SELECT i.productId FROM c JOIN i IN c.orders[0].items', ['orders/items/productId']],
        ['SELECT p.productId FROM c JOIN i IN c.items JOIN p IN i.products', ['items/products/productId']],
        [
            'SELECT i.productId FROM c JOIN i IN c.items WHERE EXISTS (SELECT VALUE p.productId FROM p IN i.products)',
            ['items/productId', 'items/products/productId'],
        ],
        [
            'SELECT i.productId FROM c JOIN i IN c.items WHERE EXISTS (SELECT VALUE i.productId FROM i IN c.otherItems) ORDER BY i.createdAt',
            ['items/productId', 'otherItems/productId', 'items/createdAt'],
        ],
        [
            'SELECT i.productId FROM c JOIN i IN c.items WHERE EXISTS (SELECT VALUE i.productId FROM i)',
            ['items/productId', 'productId'],
        ],
        [
            'SELECT c.productId FROM c WHERE EXISTS (SELECT VALUE c.productId FROM c IN c.items)',
            ['productId', 'items/productId'],
        ],
        [
            'SELECT c.id FROM c WHERE EXISTS (SELECT VALUE i.productId FROM i IN c.items) AND EXISTS (SELECT VALUE i.productId FROM i IN c.otherItems)',
            ['id', 'items/productId', 'otherItems/productId'],
        ],
        ['SELECT VALUE doc FROM Orders AS doc', []],
        ['SELECT c.customer.c FROM c', ['customer/c']],
        [
            'SELECT customer.customerId FROM c WHERE EXISTS (SELECT VALUE customer FROM customer IN c.items)',
            ['customer/customerId'],
        ],
        [
            'SELECT (SELECT VALUE x.customer.customerId FROM Orders x), x.customer.customerId FROM c',
            ['customer/customerId', 'x/customer/customerId'],
        ],
        [
            'SELECT c.id FROM c WHERE EXISTS (SELECT VALUE d.customer.customerId FROM Orders d WHERE d.id = c.id)',
            ['id', 'customer/customerId'],
        ],
        [
            'SELECT c.customer.address.city FROM c WHERE c.customer.customerId = @id ORDER BY c.customer.address.city',
            ['customer/address/city', 'customer/customerId'],
        ],
        ['SELECT c.customer, c.customer.customerId FROM c', ['customer', 'customer/customerId']],
        ['SELECT c.customer.customerId, c.customerId FROM c', ['customer/customerId', 'customerId']],
        ['SELECT c["customer.info"]["customer-id"] FROM c', ['customer.info/customer-id']],
        ['SELECT c.customer.customerId, c["customer"]["customerId"] FROM c', ['customer/customerId']],
        [
            'SELECT "customer/customerId" AS customerId FROM c WHERE c.id = @customerId /* c.customer.customerId */',
            ['id'],
        ],
        ['SELECT VALUE { "customerId": LOWER(c.customer.customerId) } FROM c', ['customer/customerId']],
        ['SELECT c.payload[c.lookup.field].id FROM c', ['payload', 'lookup/field']],
        ['SELECT udf.details(c.customer.customerId).id FROM c', ['customer/customerId']],
        ['SELECT * FROM c', []],
        ['', []],
    ])('extracts exact references from %s', (query, names) => {
        const result = queryPropertyNames(query);
        expect(result.valid).toBe(true);
        expect(new Set(result.names)).toEqual(new Set(names));
        expect(result.names).toHaveLength(names.length);
    });

    it('marks incomplete SQL as unavailable for automatic selection', () => {
        expect(queryPropertyNames('SELECT * FROM c WHERE').valid).toBe(false);
    });

    it('derives selections for every catalog predicate without changing stored defaults', () => {
        for (const scenario of Object.values(DATA_MODEL_DEFAULTS)) {
            for (const container of scenario.containers) {
                for (const read of container.reads) {
                    const selected = readFilterProperties(read);
                    expect(
                        selected.every((name) => container.properties.some((property) => property.name === name)),
                    ).toBe(true);
                    expect(selected.length > 0).toBe(Boolean(read.filters));
                    expect(queryPropertyNames(read.filters ? `SELECT ${read.filters} FROM c` : '').valid).toBe(true);
                }
            }
        }
    });

    it('retains explicit empty selections and names containing punctuation', () => {
        expect(readFilterProperties({ filters: [] })).toEqual([]);
        expect(readFilterProperties({ filters: ['a,b', 'tenant-id'] })).toEqual(['a,b', 'tenant-id']);
    });

    it('derives full nested paths from legacy predicates without rewriting saved selections', () => {
        expect(readFilterProperties({ filters: 'c.customer.customerId = @id' })).toEqual(['customer/customerId']);
        expect(readFilterProperties({ filters: 'c["customer"]["customerId"] = @id' })).toEqual(['customer/customerId']);
        expect(readFilterProperties({ filters: ['customer/customerId'] })).toEqual(['customer/customerId']);
    });
});
