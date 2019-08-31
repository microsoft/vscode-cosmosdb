/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isArray } from 'util';
import * as vscode from 'vscode';

/**
 * Retrieve a string setting, and throw an error if the value is not a string
 */
export function getWorkspaceConfiguration<T extends string>(key: string, expectedTypeOf: 'string', defaultValue?: T): T | typeof defaultValue;

/**
 * Retrieve a numeric setting, and throw an error if the value is not a number
 */
export function getWorkspaceConfiguration<T extends number>(key: string, expectedTypeOf: 'number', defaultValue?: 'number'): T | typeof defaultValue;

/**
 * Retrieve a string setting, and throw an error if the value is not a string
 */
export function getWorkspaceConfiguration<T>(key: string, expectedTypeOf: string, defaultValue?: unknown): unknown | undefined {
    let anyValue: unknown = vscode.workspace.getConfiguration().get<T>(key);
    if (typeof anyValue === expectedTypeOf) {
        return <T>anyValue;
    }

    if (anyValue === undefined || anyValue === null) {
        return defaultValue;
    }

    throw new Error(`Unexpected value for configuration setting '${key}'. Expecting value of type '${expectedTypeOf}', but found: ${String(anyValue)}`);
}

/**
 * Retrieve a numeric array setting, and throw an error if the value is not an array of numbers
 */
export function getWorkspaceArrayConfiguration<T extends number>(key: string, expectedElementTypeOf?: 'number', defaultValue?: (T | undefined)[]): T | typeof defaultValue;

/**
 * Retrieve a string array setting, and throw an error if the value is not an array of strings
 */
export function getWorkspaceArrayConfiguration<T extends string>(key: string, expectedElementTypeOf: 'string', defaultValue?: T[]): (T | undefined)[] | typeof defaultValue;

export function getWorkspaceArrayConfiguration<T>(key: string, expectedElementTypeOf: string, defaultValue?: T[]): unknown[] | undefined {
    let anyValue: unknown = vscode.workspace.getConfiguration().get<T[]>(key);
    if (anyValue === undefined || anyValue === null) {
        return defaultValue;
    }

    if (isArray(anyValue)) {
        let anyArray = <unknown[]>anyValue;
        if (!anyArray.length) {
            // Array is empty
            return [];
        }

        // Check type of each element
        for (let element of anyArray) {
            if (element === undefined || element === null || typeof element !== expectedElementTypeOf) {
                throw new Error(`Unexpected value for configuration setting '${key}'.  One of the array elements was not of the expected type: ${String(element)}`);
            }
        }

        return anyArray;
    } else {
        throw new Error(`Unexpected value for configuration setting '${key}'.  Expected an array, but found: ${String(anyValue)}`);
    }
}
