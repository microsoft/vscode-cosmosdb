/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents the different data types that can be stored in a NoSQL document.
 * The string representation is casesensitive and should match the NoSQL documentation.
 */
export enum NoSQLTypes {
    String = 'string',
    Number = 'number',
    Boolean = 'boolean',
    Object = 'object',
    Array = 'array',
    Null = 'null',
    Undefined = 'undefined',
    Timestamp = 'timestamp',
    // Add any deprecated types if necessary
    _UNKNOWN_ = '_unknown_', // Catch-all for unknown types
}

export namespace NoSQLTypes {
    const displayStringMap: Record<NoSQLTypes, string> = {
        [NoSQLTypes.String]: 'String',
        [NoSQLTypes.Number]: 'Number',
        [NoSQLTypes.Boolean]: 'Boolean',
        [NoSQLTypes.Object]: 'Object',
        [NoSQLTypes.Array]: 'Array',
        [NoSQLTypes.Null]: 'Null',
        [NoSQLTypes.Undefined]: 'Undefined',
        [NoSQLTypes.Timestamp]: 'Timestamp',
        [NoSQLTypes._UNKNOWN_]: 'Unknown',
    };

    export function toDisplayString(type: NoSQLTypes): string {
        return displayStringMap[type] || 'Unknown';
    }

    export function toString(type: NoSQLTypes): string {
        return type;
    }

    /**
     * Converts a NoSQL data type to a case sensitive JSON data type
     * @param type The NoSQL data type
     * @returns A corresponding JSON data type (please note: it's case sensitive)
     */
    export function toJSONType(type: NoSQLTypes): string {
        switch (type) {
            case NoSQLTypes.String:
            case NoSQLTypes.Timestamp:
                return 'string';

            case NoSQLTypes.Boolean:
                return 'boolean';

            case NoSQLTypes.Number:
                return 'number';

            case NoSQLTypes.Object:
                return 'object';

            case NoSQLTypes.Array:
                return 'array';

            case NoSQLTypes.Null:
            case NoSQLTypes.Undefined:
                return 'null';

            default:
                return 'string'; // Default to string for unknown types
        }
    }

    /**
     * Accepts a value from a NoSQL 'Document' object and returns the inferred type.
     * @param value The value of a field in a NoSQL 'Document' object
     * @returns
     */
    export function inferType(value: unknown): NoSQLTypes {
        if (value === null) return NoSQLTypes.Null;
        if (value === undefined) return NoSQLTypes.Undefined;

        switch (typeof value) {
            case 'string':
                return NoSQLTypes.String;
            case 'number':
                return NoSQLTypes.Number;
            case 'boolean':
                return NoSQLTypes.Boolean;
            case 'object':
                if (Array.isArray(value)) {
                    return NoSQLTypes.Array;
                }

                // Default to Object if none of the above match
                return NoSQLTypes.Object;
            default:
                // This should never happen, but if it does, we'll catch it here
                // TODO: add telemetry somewhere to know when it happens (not here, this could get hit too often)
                return NoSQLTypes._UNKNOWN_;
        }
    }
}
