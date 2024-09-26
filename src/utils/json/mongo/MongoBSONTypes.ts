/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Binary,
    BSONSymbol,
    Code,
    DBRef,
    Decimal128,
    Double,
    Int32,
    Long,
    MaxKey,
    MinKey,
    ObjectId,
    Timestamp,
} from 'mongodb';

/**
 * Represents the different data types that can be stored in a MongoDB document.
 * The string representation is casesensitive and should match the MongoDB documentation.
 */
export enum MongoBSONTypes {
    String = 'string',
    Number = 'number',
    Int32 = 'int32',
    Double = 'double',
    Decimal128 = 'decimal128',
    Long = 'long',
    Boolean = 'boolean',
    Object = 'object',
    Array = 'array',
    Null = 'null',
    Undefined = 'undefined',
    Date = 'date',
    RegExp = 'regexp',
    Binary = 'binary',
    ObjectId = 'objectid',
    Symbol = 'symbol',
    Timestamp = 'timestamp',
    MinKey = 'minkey',
    MaxKey = 'maxkey',
    DBRef = 'dbref',
    Code = 'code',
    CodeWithScope = 'codewithscope',
    Map = 'map',
    // Add any deprecated types if necessary
    _UNKNOWN_ = '_unknown_', // Catch-all for unknown types
}

export namespace MongoBSONTypes {
    const displayStringMap: Record<MongoBSONTypes, string> = {
        [MongoBSONTypes.String]: 'String',
        [MongoBSONTypes.Number]: 'Number',
        [MongoBSONTypes.Int32]: 'Int32',
        [MongoBSONTypes.Double]: 'Double',
        [MongoBSONTypes.Decimal128]: 'Decimal128',
        [MongoBSONTypes.Long]: 'Long',
        [MongoBSONTypes.Boolean]: 'Boolean',
        [MongoBSONTypes.Object]: 'Object',
        [MongoBSONTypes.Array]: 'Array',
        [MongoBSONTypes.Null]: 'Null',
        [MongoBSONTypes.Undefined]: 'Undefined',
        [MongoBSONTypes.Date]: 'Date',
        [MongoBSONTypes.RegExp]: 'RegExp',
        [MongoBSONTypes.Binary]: 'Binary',
        [MongoBSONTypes.ObjectId]: 'ObjectId',
        [MongoBSONTypes.Symbol]: 'Symbol',
        [MongoBSONTypes.Timestamp]: 'Timestamp',
        [MongoBSONTypes.MinKey]: 'MinKey',
        [MongoBSONTypes.MaxKey]: 'MaxKey',
        [MongoBSONTypes.DBRef]: 'DBRef',
        [MongoBSONTypes.Code]: 'Code',
        [MongoBSONTypes.CodeWithScope]: 'CodeWithScope',
        [MongoBSONTypes.Map]: 'Map',
        [MongoBSONTypes._UNKNOWN_]: 'Unknown',
    };

    export function toDisplayString(type: MongoBSONTypes): string {
        return displayStringMap[type] || 'Unknown';
    }

    export function toString(type: MongoBSONTypes): string {
        return type;
    }

    /**
     * Converts a MongoDB data type to a case sensitive JSON data type
     * @param type The MongoDB data type
     * @returns A corresponding JSON data type (please note: it's case sensitive)
     */
    export function toJSONType(type: MongoBSONTypes): string {
        switch (type) {
            case MongoBSONTypes.String:
            case MongoBSONTypes.Symbol:
            case MongoBSONTypes.Date:
            case MongoBSONTypes.Timestamp:
            case MongoBSONTypes.ObjectId:
            case MongoBSONTypes.RegExp:
            case MongoBSONTypes.Binary:
            case MongoBSONTypes.Code:
                return 'string';

            case MongoBSONTypes.Boolean:
                return 'boolean';

            case MongoBSONTypes.Int32:
            case MongoBSONTypes.Long:
            case MongoBSONTypes.Double:
            case MongoBSONTypes.Decimal128:
                return 'number';

            case MongoBSONTypes.Object:
            case MongoBSONTypes.Map:
            case MongoBSONTypes.DBRef:
            case MongoBSONTypes.CodeWithScope:
                return 'object';

            case MongoBSONTypes.Array:
                return 'array';

            case MongoBSONTypes.Null:
            case MongoBSONTypes.Undefined:
            case MongoBSONTypes.MinKey:
            case MongoBSONTypes.MaxKey:
                return 'null';

            default:
                return 'string'; // Default to string for unknown types
        }
    }

    /**
     * Accepts a value from a MongoDB 'Document' object and returns the inferred type.
     * @param value The value of a field in a MongoDB 'Document' object
     * @returns
     */
    export function inferType(value: unknown): MongoBSONTypes {
        if (value === null) return MongoBSONTypes.Null;
        if (value === undefined) return MongoBSONTypes.Undefined;

        switch (typeof value) {
            case 'string':
                return MongoBSONTypes.String;
            case 'number':
                return MongoBSONTypes.Double; // JavaScript numbers are doubles
            case 'boolean':
                return MongoBSONTypes.Boolean;
            case 'object':
                if (Array.isArray(value)) {
                    return MongoBSONTypes.Array;
                }

                // Check for common BSON types first
                if (value instanceof ObjectId) return MongoBSONTypes.ObjectId;
                if (value instanceof Int32) return MongoBSONTypes.Int32;
                if (value instanceof Double) return MongoBSONTypes.Double;
                if (value instanceof Date) return MongoBSONTypes.Date;
                if (value instanceof Timestamp) return MongoBSONTypes.Timestamp;

                // Less common types
                if (value instanceof Decimal128) return MongoBSONTypes.Decimal128;
                if (value instanceof Long) return MongoBSONTypes.Long;
                if (value instanceof MinKey) return MongoBSONTypes.MinKey;
                if (value instanceof MaxKey) return MongoBSONTypes.MaxKey;
                if (value instanceof BSONSymbol) return MongoBSONTypes.Symbol;
                if (value instanceof DBRef) return MongoBSONTypes.DBRef;
                if (value instanceof Map) return MongoBSONTypes.Map;
                if (value instanceof Buffer || value instanceof Binary) return MongoBSONTypes.Binary;
                if (value instanceof RegExp) return MongoBSONTypes.RegExp;
                if (value instanceof Code) {
                    if (value.scope) {
                        return MongoBSONTypes.CodeWithScope;
                    } else {
                        return MongoBSONTypes.Code;
                    }
                }

                // Default to Object if none of the above match
                return MongoBSONTypes.Object;
            default:
                // This should never happen, but if it does, we'll catch it here
                // TODO: add telemetry somewhere to know when it happens (not here, this could get hit too often)
                return MongoBSONTypes._UNKNOWN_;
        }
    }
}
