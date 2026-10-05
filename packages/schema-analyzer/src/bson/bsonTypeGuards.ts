/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type BSONType } from './BSONTypes.js';

interface BsonValue extends Record<PropertyKey, unknown> {
    readonly _bsontype: string;
}

interface BsonBinaryValue {
    readonly buffer: Uint8Array;
    readonly position: number;
    readonly sub_type: number;
    length(): number;
}

interface BsonObjectIdValue {
    toHexString(): string;
}

interface BsonRegExpValue {
    readonly pattern: string;
    readonly options: string;
}

interface NativeRegExpValue {
    readonly source: string;
    readonly flags: string;
}

const uuidSubtype = 4;
const legacyUuidSubtype = 3;
const bsonVersion = Symbol.for('@@mdb.bson.version');

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
    return value !== null && typeof value === 'object';
}

export function isByteArray(value: unknown): value is Uint8Array {
    return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === '[object Uint8Array]';
}

function isBsonValue(value: unknown): value is BsonValue {
    if (!isObject(value) || Object.hasOwn(value, '_bsontype')) return false;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype === null || prototype === Object.prototype) return false;

    // An own tag is document data. Inherited tags need a BSON protocol marker, including legacy wrappers.
    return (
        typeof value._bsontype === 'string' &&
        (typeof value[bsonVersion] === 'number' || typeof value.toExtendedJSON === 'function')
    );
}

function isSupportedBsonValue(value: BsonValue): boolean {
    const version = value[bsonVersion];
    return version === 5 || version === 6 || version === 7;
}

export function isBsonBinary(value: unknown): value is BsonBinaryValue {
    return (
        isBsonValue(value) &&
        isSupportedBsonValue(value) &&
        value._bsontype === 'Binary' &&
        isByteArray(value.buffer) &&
        typeof value.position === 'number' &&
        Number.isInteger(value.position) &&
        value.position >= 0 &&
        value.position <= value.buffer.byteLength &&
        typeof value.sub_type === 'number' &&
        Number.isInteger(value.sub_type) &&
        value.sub_type >= 0 &&
        value.sub_type <= 255 &&
        typeof value.length === 'function'
    );
}

export function isBsonObjectId(value: unknown): value is BsonObjectIdValue {
    if (
        !isBsonValue(value) ||
        !isSupportedBsonValue(value) ||
        value._bsontype !== 'ObjectId' ||
        typeof value.toHexString !== 'function'
    ) {
        return false;
    }
    const id = value.id;
    return isByteArray(id) && id.byteLength === 12;
}

export function isBsonRegExp(value: unknown): value is BsonRegExpValue {
    return (
        isBsonValue(value) &&
        isSupportedBsonValue(value) &&
        value._bsontype === 'BSONRegExp' &&
        typeof value.pattern === 'string' &&
        typeof value.options === 'string'
    );
}

export function isNativeRegExp(value: unknown): value is NativeRegExpValue {
    return (
        isObject(value) &&
        Object.prototype.toString.call(value) === '[object RegExp]' &&
        typeof value.source === 'string' &&
        typeof value.flags === 'string' &&
        typeof value.exec === 'function'
    );
}

export function isNativeDate(value: unknown): boolean {
    return (
        isObject(value) &&
        Object.prototype.toString.call(value) === '[object Date]' &&
        typeof value.getTime === 'function' &&
        typeof value.toISOString === 'function'
    );
}

export function isNativeMap(value: unknown): boolean {
    return (
        isObject(value) &&
        Object.prototype.toString.call(value) === '[object Map]' &&
        typeof value.size === 'number' &&
        typeof value.get === 'function' &&
        typeof value.entries === 'function'
    );
}

export function inferBsonObjectType(value: unknown): BSONType | undefined {
    if (!isBsonValue(value)) return undefined;
    if (!isSupportedBsonValue(value)) return '_unknown_';

    switch (value._bsontype) {
        case 'ObjectId':
            return isBsonObjectId(value) ? 'objectid' : '_unknown_';
        case 'Int32':
        case 'Double':
            return typeof value.value === 'number' &&
                typeof value.valueOf === 'function' &&
                value.valueOf !== Object.prototype.valueOf &&
                typeof value.toString === 'function'
                ? value._bsontype === 'Int32'
                    ? 'int32'
                    : 'double'
                : '_unknown_';
        case 'Long':
        case 'Timestamp':
            return Number.isInteger(value.low) &&
                Number.isInteger(value.high) &&
                typeof value.unsigned === 'boolean' &&
                typeof value.toNumber === 'function' &&
                typeof value.toString === 'function'
                ? value._bsontype === 'Long'
                    ? 'long'
                    : 'timestamp'
                : '_unknown_';
        case 'Decimal128':
            return isByteArray(value.bytes) && value.bytes.byteLength === 16 && typeof value.toString === 'function'
                ? 'decimal128'
                : '_unknown_';
        case 'Binary':
            if (!isBsonBinary(value)) return '_unknown_';
            if (value.position === 16) {
                if (value.sub_type === uuidSubtype) return 'uuid';
                if (value.sub_type === legacyUuidSubtype) return 'uuid-legacy';
            }
            return 'binary';
        case 'BSONRegExp':
            return isBsonRegExp(value) ? 'regexp' : '_unknown_';
        case 'BSONSymbol':
            return typeof value.value === 'string' && typeof value.toString === 'function' ? 'symbol' : '_unknown_';
        case 'Code':
            return typeof value.code === 'string' &&
                (value.scope === undefined || value.scope === null || isObject(value.scope)) &&
                typeof value.toJSON === 'function'
                ? value.scope
                    ? 'codewithscope'
                    : 'code'
                : '_unknown_';
        case 'DBRef':
            return typeof value.collection === 'string' &&
                'oid' in value &&
                (value.db === undefined || typeof value.db === 'string') &&
                typeof value.toJSON === 'function'
                ? 'dbref'
                : '_unknown_';
        case 'MinKey':
            return 'minkey';
        case 'MaxKey':
            return 'maxkey';
        default:
            return '_unknown_';
    }
}
