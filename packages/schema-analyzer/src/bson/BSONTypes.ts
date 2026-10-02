/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { inferBsonObjectType, isByteArray, isNativeDate, isNativeMap, isNativeRegExp } from './bsonTypeGuards.js';

/**
 * Represents the case-sensitive type tags used by the BSON document analyzer.
 * For the underlying BSON types, see:
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

        case 'number':
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
 * Accepts a value from a BSON document and returns the inferred type.
 * Recognizes compatible BSON shapes across module copies without relying on constructor identity.
 * @param value - The value of a field in a BSON document
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

            if (isByteArray(value)) return 'binary';
            if (isNativeDate(value)) return 'date';
            if (isNativeMap(value)) return 'map';
            if (isNativeRegExp(value)) return 'regexp';
            return inferBsonObjectType(value) ?? 'object';
        default:
            return '_unknown_';
    }
}
