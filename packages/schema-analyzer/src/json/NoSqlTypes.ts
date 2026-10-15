/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the case-sensitive type tags used by the JSON document analyzer.
 * Includes tags for JavaScript values such as undefined and a fallback for unrecognized values.
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
 * Converts a JSON analyzer type tag to a case-sensitive JSON Schema type string.
 * @param type - The JSON analyzer type tag
 * @returns A corresponding JSON Schema type
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
 * Accepts a value from a JSON document and returns the inferred type.
 * @param value - The value of a field in a JSON document
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
