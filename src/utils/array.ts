/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function filterType<T>(arr: object[] | undefined, genericConstructor: new (...args: unknown[]) => T): T[] {
    return arr ? <T[]>arr.filter((element) => element instanceof genericConstructor) : [];
}

export function findType<T>(
    arr: object[] | undefined,
    genericConstructor: new (...args: unknown[]) => T,
): T | undefined {
    return arr && <T>arr.find((element) => element instanceof genericConstructor);
}
