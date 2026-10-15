/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { type BSONType, bsonTypeToJSONType, inferBsonType } from './index.js';

describe('BSON numeric type mapping', () => {
    it.each(['number', 'int32', 'long', 'double', 'decimal128'] satisfies BSONType[])(
        'maps the "%s" tag to JSON Schema number',
        (type) => {
            expect(bsonTypeToJSONType(type)).toBe('number');
        },
    );

    it.each([0, -7, 1.25, Number.MAX_SAFE_INTEGER])('keeps native number %s inferred as double', (value) => {
        const type = inferBsonType(value);
        expect(type).toBe('double');
        expect(bsonTypeToJSONType(type)).toBe('number');
    });
});
