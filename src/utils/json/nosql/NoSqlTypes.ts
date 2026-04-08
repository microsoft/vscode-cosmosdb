/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the different data types that can be stored in a NoSQL document.
 * The string representation is case-sensitive and should match the NoSQL documentation.
 */
export type NoSQLTypes =
    | 'string'
    | 'number'
    | 'boolean'
    | 'object'
    | 'array'
    | 'null'
    | 'undefined'
    | 'timestamp'
    | '_unknown_';

const displayStringMap: Record<NoSQLTypes, string> = {
    string: 'String',
    number: 'Number',
    boolean: 'Boolean',
    object: 'Object',
    array: 'Array',
    null: 'Null',
    undefined: 'Undefined',
    timestamp: 'Timestamp',
    _unknown_: 'Unknown',
};

export function noSqlTypeToDisplayString(type: NoSQLTypes): string {
    return displayStringMap[type] || 'Unknown';
}

/**
 * Converts a NoSQL data type to a case sensitive JSON data type
 * @param type The NoSQL data type
 * @returns A corresponding JSON data type (please note: it's case sensitive)
 */
export function noSqlTypeToJSONType(type: NoSQLTypes): string {
    switch (type) {
        case 'string':
        case 'timestamp':
            return 'string';

        case 'boolean':
            return 'boolean';

        case 'number':
            return 'number';

        case 'object':
            return 'object';

        case 'array':
            return 'array';

        case 'null':
        case 'undefined':
            return 'null';

        default:
            return 'string'; // Default to string for unknown types
    }
}

/**
 * Accepts a value from a NoSQL 'Document' object and returns the inferred type.
 * @param value The value of a field in a NoSQL 'Document' object
 */
export function inferNoSqlType(value: unknown): NoSQLTypes {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';

    switch (typeof value) {
        case 'string':
            return 'string';
        case 'number':
            return 'number';
        case 'boolean':
            return 'boolean';
        case 'object':
            if (Array.isArray(value)) {
                return 'array';
            }
            return 'object';
        default:
            return '_unknown_';
    }
}
