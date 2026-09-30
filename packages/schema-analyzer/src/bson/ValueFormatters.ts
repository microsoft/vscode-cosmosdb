/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getBinaryLength } from './binaryUtils.js';
import { isBsonObjectId, isBsonRegExp, isNativeRegExp } from './bsonTypeGuards.js';
import { type BSONType } from './BSONTypes.js';

/**
 * Converts a BSON value to its display string representation based on its type.
 *
 * @param value - The value to be converted to a display string.
 * @param type - The BSON type tag of the value, normally obtained from inferBsonType().
 * @returns The string representation of the value.
 * @throws If the value cannot be formatted or JSON serialization fails or produces no string.
 */
export function valueToDisplayString(value: unknown, type: BSONType): string {
    switch (type) {
        case 'string': {
            return value as string;
        }
        case 'number':
        case 'int32':
        case 'double':
        case 'decimal128':
        case 'long': {
            return (value as number).toString();
        }
        case 'boolean': {
            return (value as boolean).toString();
        }
        case 'date': {
            return (value as Date).toISOString();
        }
        case 'objectid': {
            if (!isBsonObjectId(value)) throw new TypeError('Expected a BSON ObjectId value.');
            return value.toHexString();
        }
        case 'null': {
            return 'null';
        }
        case 'undefined': {
            return 'undefined';
        }
        case 'regexp': {
            if (isNativeRegExp(value)) return `${value.source} ${value.flags}`;
            if (isBsonRegExp(value)) return `${value.pattern} ${value.options}`;
            throw new TypeError('Expected a JavaScript or BSON regular expression.');
        }
        case 'binary': {
            return `Binary[${getBinaryLength(value)}]`;
        }
        case 'symbol': {
            return (value as symbol).toString();
        }
        case 'timestamp': {
            return (value as { toString: () => string }).toString();
        }
        case 'minkey': {
            return 'MinKey';
        }
        case 'maxkey': {
            return 'MaxKey';
        }
        case 'code':
        case 'codewithscope':
        case 'array':
        case 'object':
        case 'map':
        case 'dbref':
        case 'uuid':
        case 'uuid-legacy':
        case '_unknown_':
        default: {
            const serialized = JSON.stringify(value);
            if (serialized === undefined) {
                throw new TypeError('Value cannot be represented as a JSON string.');
            }
            return serialized;
        }
    }
}
