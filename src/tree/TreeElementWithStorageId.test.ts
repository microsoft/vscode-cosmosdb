/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { isTreeElementWithStorageId } from './TreeElementWithStorageId';

describe('isTreeElementWithStorageId', () => {
    it('accepts an object with a storageId property', () => {
        expect(isTreeElementWithStorageId({ storageId: 'abc-123' })).toBe(true);
        // The guard only checks for the property's presence, not its type.
        expect(isTreeElementWithStorageId({ storageId: 0 })).toBe(true);
    });

    it('rejects objects without storageId and non-objects', () => {
        expect(isTreeElementWithStorageId({})).toBe(false);
        expect(isTreeElementWithStorageId(null)).toBe(false);
        expect(isTreeElementWithStorageId(undefined)).toBe(false);
        expect(isTreeElementWithStorageId('storageId')).toBe(false);
    });
});
