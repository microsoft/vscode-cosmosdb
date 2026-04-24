/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { getCompletions, type JSONSchema } from '../index.js';

// Real-world schema from user's collection
const productSchema: JSONSchema = {
    properties: {
        productName: { 'x-occurrence': 100, type: 'string' },
        productDescription: { 'x-occurrence': 100, type: 'string' },
        price: { 'x-occurrence': 100, type: 'string' },
        department: { 'x-occurrence': 100, type: 'string' },
        product: { 'x-occurrence': 100, type: 'string' },
        productMaterial: { 'x-occurrence': 100, type: 'string' },
        isbn: { 'x-occurrence': 100, type: 'string' },
        uuid: { 'x-occurrence': 100, type: 'string' },
        productAdjective: { 'x-occurrence': 100, type: 'string' },
        id: { 'x-occurrence': 100, type: 'string' },
        _rid: { 'x-occurrence': 100, type: 'string' },
        _self: { 'x-occurrence': 100, type: 'string' },
        _etag: { 'x-occurrence': 100, type: 'string' },
        _attachments: { 'x-occurrence': 100, type: 'string' },
        _ts: { 'x-occurrence': 100, type: 'number' },
    },
    'x-documentsInspected': 100,
};

// Nested schema for testing deep navigation
const nestedSchema: JSONSchema = {
    properties: {
        id: { 'x-occurrence': 100, type: 'string' },
        name: { 'x-occurrence': 95, type: 'string' },
        address: {
            'x-occurrence': 90,
            type: 'object',
            properties: {
                street: { 'x-occurrence': 90, type: 'string' },
                city: { 'x-occurrence': 90, type: 'string' },
                zip: { 'x-occurrence': 85, type: 'string' },
                geo: {
                    'x-occurrence': 50,
                    type: 'object',
                    properties: {
                        lat: { 'x-occurrence': 50, type: 'number' },
                        lng: { 'x-occurrence': 50, type: 'number' },
                    },
                },
            },
        },
        tags: {
            'x-occurrence': 80,
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    name: { 'x-occurrence': 80, type: 'string' },
                    value: { 'x-occurrence': 75, type: 'string' },
                },
            },
        },
    },
};

describe('SqlCompletion — context detection', () => {
    it('suggests SELECT at empty query', () => {
        const items = getCompletions({ query: '', offset: 0 });
        expect(items.some((i) => i.label === 'SELECT')).toBe(true);
    });

    it('suggests modifiers after SELECT', () => {
        const items = getCompletions({ query: 'SELECT ', offset: 7 });
        expect(items.some((i) => i.label === 'DISTINCT')).toBe(true);
        expect(items.some((i) => i.label === 'TOP')).toBe(true);
        expect(items.some((i) => i.label === 'VALUE')).toBe(true);
        expect(items.some((i) => i.label === '*')).toBe(true);
    });

    it('suggests BY after ORDER', () => {
        const items = getCompletions({ query: 'SELECT * FROM c ORDER ', offset: 22 });
        expect(items.some((i) => i.label === 'BY')).toBe(true);
    });

    it('suggests BY after GROUP', () => {
        const items = getCompletions({ query: 'SELECT * FROM c GROUP ', offset: 22 });
        expect(items.some((i) => i.label === 'BY')).toBe(true);
    });

    it('suggests clause keywords after FROM alias', () => {
        //                                          cursor here ↓
        const items = getCompletions({ query: 'SELECT * FROM c ', offset: 16 });
        expect(items.some((i) => i.label === 'WHERE')).toBe(true);
        expect(items.some((i) => i.label === 'ORDER BY')).toBe(true);
        expect(items.some((i) => i.label === 'JOIN')).toBe(true);
    });
});

describe('SqlCompletion — field suggestions from schema', () => {
    it("suggests top-level fields after 'c.'", () => {
        const items = getCompletions({
            query: 'SELECT c. FROM c',
            offset: 9, // right after "c."
            schema: productSchema,
        });
        expect(items.some((i) => i.label === 'productName' && i.kind === 'field')).toBe(true);
        expect(items.some((i) => i.label === 'price' && i.kind === 'field')).toBe(true);
        expect(items.some((i) => i.label === '_ts' && i.kind === 'field')).toBe(true);
        expect(items.some((i) => i.label === 'id' && i.kind === 'field')).toBe(true);
    });

    it("filters fields by typing prefix after 'c.pro'", () => {
        const items = getCompletions({
            query: 'SELECT c.pro FROM c',
            offset: 12, // after "c.pro"
            schema: productSchema,
        });
        expect(items.every((i) => i.label.toLowerCase().startsWith('pro'))).toBe(true);
        expect(items.some((i) => i.label === 'productName')).toBe(true);
        expect(items.some((i) => i.label === 'price')).toBe(false); // "price" doesn't start with "pro"
    });

    it("suggests nested fields after 'c.address.'", () => {
        const items = getCompletions({
            query: 'SELECT c.address. FROM c',
            offset: 17, // after "c.address."
            schema: nestedSchema,
        });
        expect(items.some((i) => i.label === 'street')).toBe(true);
        expect(items.some((i) => i.label === 'city')).toBe(true);
        expect(items.some((i) => i.label === 'zip')).toBe(true);
        expect(items.some((i) => i.label === 'geo')).toBe(true);
    });

    it("suggests deeply nested fields after 'c.address.geo.'", () => {
        const items = getCompletions({
            query: 'SELECT c.address.geo. FROM c',
            offset: 21, // after "c.address.geo."
            schema: nestedSchema,
        });
        expect(items.some((i) => i.label === 'lat')).toBe(true);
        expect(items.some((i) => i.label === 'lng')).toBe(true);
    });

    it('includes type info in detail', () => {
        const items = getCompletions({
            query: 'SELECT c. FROM c',
            offset: 9,
            schema: nestedSchema,
        });
        const tsField = items.find((i) => i.label === 'name');
        expect(tsField?.detail).toBe('string');
        const addrField = items.find((i) => i.label === 'address');
        expect(addrField?.detail).toBe('object');
    });

    it("suggests fields in WHERE clause after 'c.'", () => {
        const items = getCompletions({
            query: 'SELECT * FROM c WHERE c.',
            offset: 24,
            schema: productSchema,
        });
        expect(items.some((i) => i.label === 'productName')).toBe(true);
        expect(items.some((i) => i.label === '_ts')).toBe(true);
    });
});

describe('SqlCompletion — dot completion without FROM clause', () => {
    it("suggests top-level fields for 'SELECT c.' (no FROM yet)", () => {
        const items = getCompletions({
            query: 'SELECT c.',
            offset: 9,
            schema: nestedSchema,
        });
        expect(items.some((i) => i.label === 'id' && i.kind === 'field')).toBe(true);
        expect(items.some((i) => i.label === 'name' && i.kind === 'field')).toBe(true);
        expect(items.some((i) => i.label === 'address' && i.kind === 'field')).toBe(true);
    });

    it("suggests nested fields for 'SELECT c.address.' (no FROM yet)", () => {
        const items = getCompletions({
            query: 'SELECT c.address.',
            offset: 17,
            schema: nestedSchema,
        });
        expect(items.some((i) => i.label === 'street')).toBe(true);
        expect(items.some((i) => i.label === 'city')).toBe(true);
        expect(items.some((i) => i.label === 'geo')).toBe(true);
    });

    it("filters fields by prefix for 'SELECT c.na' (no FROM yet)", () => {
        const items = getCompletions({
            query: 'SELECT c.na',
            offset: 11,
            schema: nestedSchema,
        });
        expect(items.some((i) => i.label === 'name')).toBe(true);
        expect(items.every((i) => i.label.toLowerCase().startsWith('na'))).toBe(true);
    });
});

describe('SqlCompletion — alias detection', () => {
    it('detects alias from FROM clause', () => {
        const items = getCompletions({
            query: 'SELECT  FROM c',
            offset: 7, // after "SELECT "
            schema: productSchema,
        });
        expect(items.some((i) => i.label === 'c' && i.kind === 'alias')).toBe(true);
    });

    it('detects alias with AS keyword', () => {
        const items = getCompletions({
            query: 'SELECT  FROM products AS p',
            offset: 7,
        });
        expect(items.some((i) => i.label === 'p' && i.kind === 'alias')).toBe(true);
    });

    it('detects iterator alias from JOIN ... IN', () => {
        const items = getCompletions({
            query: 'SELECT  FROM c JOIN t IN c.tags',
            offset: 7,
        });
        expect(items.some((i) => i.label === 'c' && i.kind === 'alias')).toBe(true);
        expect(items.some((i) => i.label === 't' && i.kind === 'alias')).toBe(true);
    });
});

describe('SqlCompletion — function suggestions', () => {
    it('suggests functions in expression context', () => {
        const items = getCompletions({
            query: 'SELECT * FROM c WHERE ',
            offset: 22,
        });
        expect(items.some((i) => i.label === 'ARRAY_LENGTH' && i.kind === 'function')).toBe(true);
        expect(items.some((i) => i.label === 'IS_DEFINED' && i.kind === 'function')).toBe(true);
    });

    it('suggests functions after SELECT', () => {
        const items = getCompletions({ query: 'SELECT ', offset: 7 });
        expect(items.some((i) => i.label === 'COUNT' && i.kind === 'function')).toBe(true);
    });

    it('filters functions by prefix', () => {
        const items = getCompletions({
            query: 'SELECT * FROM c WHERE ARRAY_',
            offset: 28,
        });
        expect(items.every((i) => i.label.startsWith('ARRAY_'))).toBe(true);
    });
});

describe('SqlCompletion — priority ordering', () => {
    it('ranks * first after SELECT', () => {
        const items = getCompletions({ query: 'SELECT ', offset: 7 });
        const sorted = [...items].sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
        expect(sorted[0].label).toBe('*');
    });

    it('ranks TOP before DISTINCT before VALUE after SELECT', () => {
        const items = getCompletions({ query: 'SELECT ', offset: 7 });
        const topItem = items.find((i) => i.label === 'TOP')!;
        const distItem = items.find((i) => i.label === 'DISTINCT')!;
        const valItem = items.find((i) => i.label === 'VALUE')!;
        expect(topItem.sortText! < distItem.sortText!).toBe(true);
        expect(distItem.sortText! < valItem.sortText!).toBe(true);
    });

    it('ranks WHERE first after FROM clause', () => {
        const items = getCompletions({ query: 'SELECT * FROM c ', offset: 16 });
        const sorted = [...items].sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
        expect(sorted[0].label).toBe('WHERE');
    });

    it('ranks ORDER BY before GROUP BY after FROM clause', () => {
        const items = getCompletions({ query: 'SELECT * FROM c ', offset: 16 });
        const orderItem = items.find((i) => i.label === 'ORDER BY')!;
        const groupItem = items.find((i) => i.label === 'GROUP BY')!;
        expect(orderItem.sortText! < groupItem.sortText!).toBe(true);
    });

    it('ranks AND/OR before BETWEEN/IN in WHERE expression', () => {
        const items = getCompletions({ query: 'SELECT * FROM c WHERE ', offset: 22 });
        const andItem = items.find((i) => i.label === 'AND')!;
        const betweenItem = items.find((i) => i.label === 'BETWEEN')!;
        expect(andItem.sortText! < betweenItem.sortText!).toBe(true);
    });

    it('ranks aliases above functions after SELECT', () => {
        const items = getCompletions({
            query: 'SELECT  FROM c',
            offset: 7,
            aliases: ['c'],
        });
        const aliasItem = items.find((i) => i.label === 'c')!;
        const funcItem = items.find((i) => i.kind === 'function')!;
        expect(aliasItem.sortText! < funcItem.sortText!).toBe(true);
    });

    it('ranks COUNT/SUM above obscure functions', () => {
        const items = getCompletions({ query: 'SELECT ', offset: 7 });
        const countItem = items.find((i) => i.label === 'COUNT')!;
        const stItem = items.find((i) => i.label === 'ST_DISTANCE')!;
        expect(countItem.sortText! < stItem.sortText!).toBe(true);
    });

    it('ranks schema fields by x-occurrence', () => {
        const items = getCompletions({
            query: 'SELECT c. FROM c',
            offset: 9,
            schema: {
                properties: {
                    rare: { 'x-occurrence': 10, type: 'string' },
                    common: { 'x-occurrence': 95, type: 'string' },
                    veryCommon: { 'x-occurrence': 100, type: 'string' },
                },
            },
        });
        const sorted = [...items].sort((a, b) => (a.sortText ?? '').localeCompare(b.sortText ?? ''));
        expect(sorted[0].label).toBe('veryCommon');
        expect(sorted[1].label).toBe('common');
        expect(sorted[2].label).toBe('rare');
    });
});
