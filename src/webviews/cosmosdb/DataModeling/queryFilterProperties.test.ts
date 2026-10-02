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
        ['SELECT * FROM c', []],
        ['', []],
    ])('extracts exact references from %s', (query, names) => {
        const result = queryPropertyNames(query);
        expect(result.valid).toBe(true);
        expect(new Set(result.names)).toEqual(new Set(names));
    });

    it('marks incomplete SQL as unavailable for automatic selection', () => {
        expect(queryPropertyNames('SELECT * FROM c WHERE').valid).toBe(false);
    });

    it('derives selections for every catalog predicate without changing stored defaults', () => {
        for (const scenario of Object.values(DATA_MODEL_DEFAULTS)) {
            for (const container of scenario.containers) {
                for (const read of container.reads) {
                    const selected = readFilterProperties({ ...read, id: 'read' });
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
        expect(readFilterProperties({ id: 'r', pattern: '', filters: [], qps: 0 })).toEqual([]);
        expect(readFilterProperties({ id: 'r', pattern: '', filters: ['a,b', 'tenant-id'], qps: 0 })).toEqual([
            'a,b',
            'tenant-id',
        ]);
    });
});
