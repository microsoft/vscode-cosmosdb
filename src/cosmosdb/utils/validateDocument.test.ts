/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type PartitionKeyDefinition } from '@azure/cosmos';
import { validateDocument, validateDocumentId, validatePartitionKey } from './validateDocument';

describe('validateDocument', () => {
    describe('validateDocument', () => {
        it('returns no errors for a valid object with no partition key', () => {
            expect(validateDocument('{ "id": "abc", "value": 1 }')).toEqual([]);
        });

        it('returns a syntax error for invalid JSON', () => {
            const errors = validateDocument('{ not valid json ');
            expect(errors.length).toBeGreaterThan(0);
        });

        it('collects id validation errors', () => {
            const errors = validateDocument('{ "id": "a/b" }');
            expect(errors).toContain('Id contains illegal chars (/, \\, ?, #).');
        });

        it('collects partition key errors when partition key is required', () => {
            const partitionKey: PartitionKeyDefinition = { paths: ['/pk'] };
            const errors = validateDocument('{ "id": "abc", "pk": "" }', partitionKey, false);
            expect(errors).toContain('Partition key pk is invalid.');
        });

        it('ignores partition key when null/undefined is allowed (default)', () => {
            const partitionKey: PartitionKeyDefinition = { paths: ['/pk'] };
            expect(validateDocument('{ "id": "abc" }', partitionKey)).toEqual([]);
        });
    });

    describe('validatePartitionKey', () => {
        it('returns undefined when there is no partition key definition', () => {
            expect(validatePartitionKey({}, undefined, false)).toBeUndefined();
        });

        it('returns undefined when null/undefined values are allowed', () => {
            const partitionKey: PartitionKeyDefinition = { paths: ['/pk'] };
            expect(validatePartitionKey({}, partitionKey, true)).toBeUndefined();
        });

        it('returns undefined when the partition key value is present', () => {
            const partitionKey: PartitionKeyDefinition = { paths: ['/pk'] };
            expect(validatePartitionKey({ pk: 'value' }, partitionKey, false)).toBeUndefined();
        });

        it('returns an error when the partition key value is empty', () => {
            const partitionKey: PartitionKeyDefinition = { paths: ['/pk'] };
            expect(validatePartitionKey({ pk: '' }, partitionKey, false)).toEqual(['Partition key pk is invalid.']);
        });

        it('strips the leading slash from the partition key path in the message', () => {
            const partitionKey: PartitionKeyDefinition = { paths: ['/myKey'] };
            expect(validatePartitionKey({ myKey: '' }, partitionKey, false)).toEqual([
                'Partition key myKey is invalid.',
            ]);
        });
    });

    describe('validateDocumentId', () => {
        it('returns undefined when there is no id', () => {
            expect(validateDocumentId({})).toBeUndefined();
        });

        it('returns undefined for a valid string id', () => {
            expect(validateDocumentId({ id: 'valid-id' })).toBeUndefined();
        });

        it('returns an error when id is not a string', () => {
            expect(validateDocumentId({ id: 42 })).toEqual(['Id must be a string.']);
        });

        it.each([['a/b'], ['a\\b'], ['a?b'], ['a#b']])('flags illegal char in id %s', (id) => {
            expect(validateDocumentId({ id })).toContain('Id contains illegal chars (/, \\, ?, #).');
        });

        it('returns an error when the id ends with a space', () => {
            expect(validateDocumentId({ id: 'trailing ' })).toEqual(['Id ends with a space.']);
        });

        it('reports multiple errors at once', () => {
            const errors = validateDocumentId({ id: 'a/b ' });
            expect(errors).toContain('Id contains illegal chars (/, \\, ?, #).');
            expect(errors).toContain('Id ends with a space.');
        });
    });
});
