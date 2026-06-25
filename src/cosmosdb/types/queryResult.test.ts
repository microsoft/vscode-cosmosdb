/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { describe, expect, it } from 'vitest';
import { isCosmosDBRecord, isCosmosDBRecordIdentifier } from './queryResult';

/** A complete Cosmos DB document with all mandatory system-generated fields. */
function fullRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'doc-1',
        _rid: 'rid-1',
        _ts: 1700000000,
        _self: 'dbs/x/colls/y/docs/z',
        _etag: '"etag"',
        _attachments: 'attachments/',
        ...overrides,
    };
}

describe('isCosmosDBRecordIdentifier', () => {
    it('returns false for non-objects', () => {
        expect(isCosmosDBRecordIdentifier(null)).toBe(false);
        expect(isCosmosDBRecordIdentifier(undefined)).toBe(false);
        expect(isCosmosDBRecordIdentifier('string')).toBe(false);
        expect(isCosmosDBRecordIdentifier(42)).toBe(false);
        expect(isCosmosDBRecordIdentifier([])).toBe(false);
    });

    it('returns true when a non-empty _rid is present (no partition key needed)', () => {
        expect(isCosmosDBRecordIdentifier({ _rid: 'abc' })).toBe(true);
    });

    it('returns true for a non-empty id when _rid is absent', () => {
        expect(isCosmosDBRecordIdentifier({ id: 'doc-1' })).toBe(true);
    });

    it('returns false when neither _rid nor a non-empty id is present', () => {
        expect(isCosmosDBRecordIdentifier({})).toBe(false);
        expect(isCosmosDBRecordIdentifier({ id: '' })).toBe(false);
        expect(isCosmosDBRecordIdentifier({ _rid: '' })).toBe(false);
    });

    it('verifies every partition key path exists when a definition is provided', () => {
        const pk: PartitionKeyDefinition = { paths: ['/tenantId'] } as PartitionKeyDefinition;
        expect(isCosmosDBRecordIdentifier({ id: 'doc-1', tenantId: 't1' }, pk)).toBe(true);
        expect(isCosmosDBRecordIdentifier({ id: 'doc-1' }, pk)).toBe(false);
    });

    it('resolves nested partition key paths', () => {
        const pk: PartitionKeyDefinition = { paths: ['/address/zip'] } as PartitionKeyDefinition;
        expect(isCosmosDBRecordIdentifier({ id: 'doc-1', address: { zip: '12345' } }, pk)).toBe(true);
        expect(isCosmosDBRecordIdentifier({ id: 'doc-1', address: {} }, pk)).toBe(false);
    });

    it('skips the partition key check entirely when _rid is present', () => {
        const pk: PartitionKeyDefinition = { paths: ['/missing'] } as PartitionKeyDefinition;
        expect(isCosmosDBRecordIdentifier({ _rid: 'abc' }, pk)).toBe(true);
    });
});

describe('isCosmosDBRecord', () => {
    it('returns true for a full record with all system fields', () => {
        expect(isCosmosDBRecord(fullRecord())).toBe(true);
    });

    it('returns false for non-objects', () => {
        expect(isCosmosDBRecord(null)).toBe(false);
        expect(isCosmosDBRecord('x')).toBe(false);
    });

    it('returns false when a mandatory system field is missing', () => {
        const { _etag, ...withoutEtag } = fullRecord();
        void _etag;
        expect(isCosmosDBRecord(withoutEtag)).toBe(false);
    });

    it('returns false when a system field has the wrong type', () => {
        expect(isCosmosDBRecord(fullRecord({ _ts: 'not-a-number' }))).toBe(false);
    });
});
