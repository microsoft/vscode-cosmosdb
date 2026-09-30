/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isBsonBinary, isByteArray } from './bsonTypeGuards.js';

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
