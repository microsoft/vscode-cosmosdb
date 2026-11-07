/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { readFilterProperties } from './queryFilterProperties';

describe('recommendation filter property display', () => {
    it.each([
        ['customerId = @id AND status = "pending"', ['customerId', 'status']],
        ['customerId, status', ['customerId', 'status']],
        ['c["tenant-id"] = @value', ['tenant-id']],
        ["c['tenantId'] = 'id'", ['tenantId']],
        ['c.tenantId = @id /* createdAt */', ['tenantId']],
        ['c.customer.customerId = @customerId', ['customer/customerId']],
        ['c["customer"]["customerId"] = @customerId', ['customer/customerId']],
        ["c['customer']['customerId'] = @customerId", ['customer/customerId']],
        ['c.customer["customerId"] = @customerId', ['customer/customerId']],
        ['c["customer"].customerId = @customerId', ['customer/customerId']],
        ['customer.customerId = @id', ['customer/customerId']],
        ['c.id = @id AND EXISTS (SELECT VALUE i.productId FROM i IN c.items)', ['id', 'items/productId']],
        ['EXISTS (SELECT VALUE p.productId FROM i IN c.items JOIN p IN i.products)', ['items/products/productId']],
        ['c.productId = @id AND EXISTS (SELECT VALUE c.productId FROM c IN c.items)', ['productId', 'items/productId']],
        [
            'EXISTS (SELECT VALUE i.productId FROM i IN c.items) AND EXISTS (SELECT VALUE i.productId FROM i IN c.otherItems)',
            ['items/productId', 'otherItems/productId'],
        ],
        [
            'c.customer.address.city = @city AND c.customer.customerId = @id',
            ['customer/address/city', 'customer/customerId'],
        ],
        ['c.customer.customerId, c.customerId', ['customer/customerId', 'customerId']],
        ['c["customer.info"]["customer-id"]', ['customer.info/customer-id']],
        ['c.customer.customerId, c["customer"]["customerId"]', ['customer/customerId']],
        ['LOWER(c.customer.customerId) = @id', ['customer/customerId']],
        ['', []],
    ])('displays exact property paths from the legacy predicate %s', (filters, names) => {
        expect(readFilterProperties({ filters })).toEqual(names);
    });

    it('preserves empty result filters and property names containing punctuation', () => {
        expect(readFilterProperties({ filters: [] })).toEqual([]);
        expect(readFilterProperties({ filters: ['a,b', 'tenant-id'] })).toEqual(['a,b', 'tenant-id']);
        expect(readFilterProperties({ filters: ['customer/customerId'] })).toEqual(['customer/customerId']);
    });
});
