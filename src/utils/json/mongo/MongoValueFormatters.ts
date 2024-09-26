/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Binary, type BSONRegExp, type ObjectId } from 'mongodb';
import { MongoBSONTypes } from './MongoBSONTypes';

/**
 * Converts a MongoDB value to its display string representation based on its type.
 *
 * @param value - The value to be converted to a display string.
 * @param type - The MongoDB data type of the value.
 * @returns The string representation of the value.
 *
 * The function handles various MongoDB data types including:
 * - String
 * - Number, Int32, Double, Decimal128, Long
 * - Boolean
 * - Date
 * - ObjectId
 * - Binary
 * - ...
 *
 * For unsupported or unknown types, the function defaults to JSON stringification.
 */
export function valueToDisplayString(value: unknown, type: MongoBSONTypes): string {
    switch (type) {
        case MongoBSONTypes.String: {
            return value as string;
        }
        case MongoBSONTypes.Number:
        case MongoBSONTypes.Int32:
        case MongoBSONTypes.Double:
        case MongoBSONTypes.Decimal128:
        case MongoBSONTypes.Long: {
            return (value as number).toString();
        }
        case MongoBSONTypes.Boolean: {
            return (value as boolean).toString();
        }
        case MongoBSONTypes.Date: {
            return (value as Date).toISOString();
        }
        case MongoBSONTypes.ObjectId: {
            return (value as ObjectId).toHexString();
        }
        case MongoBSONTypes.Null: {
            return 'null';
        }
        case MongoBSONTypes.RegExp: {
            const v = value as BSONRegExp;
            return `${v.pattern} ${v.options}`;
        }
        case MongoBSONTypes.Binary: {
            return `Binary[${(value as Binary).length()}]`;
        }
        case MongoBSONTypes.Symbol: {
            return (value as symbol).toString();
        }
        case MongoBSONTypes.Timestamp: {
            return (value as { toString: () => string }).toString();
        }
        case MongoBSONTypes.MinKey: {
            return 'MinKey';
        }
        case MongoBSONTypes.MaxKey: {
            return 'MaxKey';
        }
        case MongoBSONTypes.Code:
        case MongoBSONTypes.CodeWithScope: {
            return JSON.stringify(value);
        }

        case MongoBSONTypes.Array:
        case MongoBSONTypes.Object:
        case MongoBSONTypes.Map:
        case MongoBSONTypes.DBRef:
        case MongoBSONTypes.Undefined:
        case MongoBSONTypes._UNKNOWN_:
        default: {
            return JSON.stringify(value);
        }
    }
}
