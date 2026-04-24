/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Binary, type BSONRegExp, type ObjectId } from 'mongodb';
import { type BSONType } from './BSONTypes.js';

/**
 * Converts a MongoDB API value to its display string representation based on its type.
 *
 * @param value - The value to be converted to a display string.
 * @param type - The MongoDB API data type of the value.
 * @returns The string representation of the value.
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
            return (value as ObjectId).toHexString();
        }
        case 'null': {
            return 'null';
        }
        case 'regexp': {
            const v = value as BSONRegExp;
            return `${v.pattern} ${v.options}`;
        }
        case 'binary': {
            return `Binary[${(value as Binary).length()}]`;
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
        case 'codewithscope': {
            return JSON.stringify(value);
        }

        case 'array':
        case 'object':
        case 'map':
        case 'dbref':
        case 'undefined':
        case '_unknown_':
        default: {
            return JSON.stringify(value);
        }
    }
}

