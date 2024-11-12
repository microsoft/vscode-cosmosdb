/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const bsonToDisplayStringMap: Record<string, string> = {
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
    unknown: 'Unknown',
};

export function bsonStringToDisplayString(type: string): string {
    return bsonToDisplayStringMap[type] || 'Unknown';
}
