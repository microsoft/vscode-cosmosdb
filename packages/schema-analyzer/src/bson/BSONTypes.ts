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
    UUID,
} from 'mongodb';

/**
 * Represents the different data types that can be stored in a DocumentDB API / MongoDB API document.
 * The string representation is case-sensitive and should match the MongoDB API documentation.
 * https://www.mongodb.com/docs/manual/reference/bson-types/
 */
export type BSONType =
    | 'string'
    | 'number'
    | 'int32'
    | 'double'
    | 'decimal128'
    | 'long'
    | 'boolean'
    | 'object'
    | 'array'
    | 'null'
    | 'undefined'
    | 'date'
    | 'regexp'
    | 'binary'
    | 'objectid'
    | 'symbol'
    | 'timestamp'
    | 'uuid'
    | 'uuid-legacy'
    | 'minkey'
    | 'maxkey'
    | 'dbref'
    | 'code'
    | 'codewithscope'
    | 'map'
    | '_unknown_';

const displayStringMap: Record<BSONType, string> = {
    string: 'String',
    number: 'Number',
    int32: 'Int32',
    double: 'Double',
    decimal128: 'Decimal128',
    long: 'Long',
    boolean: 'Boolean',
    object: 'Object',
    array: 'Array',
    null: 'Null',
    undefined: 'Undefined',
    date: 'Date',
    regexp: 'RegExp',
    binary: 'Binary',
    objectid: 'ObjectId',
    symbol: 'Symbol',
    timestamp: 'Timestamp',
    minkey: 'MinKey',
    maxkey: 'MaxKey',
    dbref: 'DBRef',
    code: 'Code',
    codewithscope: 'CodeWithScope',
    map: 'Map',
    _unknown_: 'Unknown',
    uuid: 'UUID',
    'uuid-legacy': 'UUID (Legacy)',
};

export function bsonTypeToDisplayString(type: BSONType): string {
    return displayStringMap[type] || 'Unknown';
}

/**
 * Converts a BSON data type to a case-sensitive JSON Schema type string.
 * @param type - The BSON data type
 * @returns A corresponding JSON Schema type string
 */
export function bsonTypeToJSONType(type: BSONType): string {
    switch (type) {
        case 'string':
        case 'symbol':
        case 'date':
        case 'timestamp':
        case 'objectid':
        case 'regexp':
        case 'binary':
        case 'code':
        case 'uuid':
        case 'uuid-legacy':
            return 'string';

        case 'boolean':
            return 'boolean';

        case 'int32':
        case 'long':
        case 'double':
        case 'decimal128':
            return 'number';

        case 'object':
        case 'map':
        case 'dbref':
        case 'codewithscope':
            return 'object';

        case 'array':
            return 'array';

        case 'null':
        case 'undefined':
        case 'minkey':
        case 'maxkey':
            return 'null';

        default:
            return 'string';
    }
}

/**
 * Accepts a value from a MongoDB API `Document` object and returns the inferred BSON type.
 * @param value - The value of a field in a MongoDB API `Document` object
 */
export function inferBsonType(value: unknown): BSONType {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    switch (typeof value) {
        case 'string':
            return 'string';
        case 'number':
            return 'double';
        case 'boolean':
            return 'boolean';
        case 'object':
            if (Array.isArray(value)) {
                return 'array';
            }

            if (value instanceof ObjectId) return 'objectid';
            if (value instanceof Int32) return 'int32';
            if (value instanceof Double) return 'double';
            if (value instanceof Date) return 'date';
            if (value instanceof Timestamp) return 'timestamp';
            if (value instanceof Decimal128) return 'decimal128';
            if (value instanceof Long) return 'long';
            if (value instanceof MinKey) return 'minkey';
            if (value instanceof MaxKey) return 'maxkey';
            if (value instanceof BSONSymbol) return 'symbol';
            if (value instanceof DBRef) return 'dbref';
            if (value instanceof Map) return 'map';
            if (value instanceof UUID && value.sub_type === Binary.SUBTYPE_UUID) return 'uuid';
            if (value instanceof UUID && value.sub_type === Binary.SUBTYPE_UUID_OLD) return 'uuid-legacy';
            if (value instanceof Buffer || value instanceof Binary) return 'binary';
            if (value instanceof RegExp) return 'regexp';
            if (value instanceof Code) {
                return value.scope ? 'codewithscope' : 'code';
            }

            return 'object';
        default:
            return '_unknown_';
    }
}
