/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inferBsonObjectType, isBsonBinary, isByteArray } from './bsonTypeGuards.js';

export function getBinaryLength(value: unknown): number {
    if (isByteArray(value)) return value.byteLength;
    if (isBsonBinary(value)) {
        const length = value.length();
        if (!Number.isInteger(length) || length < 0 || length > value.buffer.byteLength) {
            throw new TypeError('BSON Binary.length() must return a valid byte length.');
        }
        return length;
    }
    throw new TypeError('Expected a Uint8Array or BSON Binary value.');
}

export function getUuidString(value: unknown, type: 'uuid' | 'uuid-legacy'): string {
    if (!isBsonBinary(value) || inferBsonObjectType(value) !== type || getBinaryLength(value) !== 16) {
        throw new TypeError('Expected a 16-byte BSON UUID value with the matching subtype.');
    }
    // Preserve stored byte order: legacy UUIDs do not identify which driver's byte-order convention was used.
    const hex = Array.from(value.buffer.subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
