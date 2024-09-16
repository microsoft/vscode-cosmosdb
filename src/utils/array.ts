/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function filterType<T>(arr: object[] | undefined, genericConstructor: new (...args: any[]) => T): T[] {
    return arr ? <T[]>arr.filter((element) => element instanceof genericConstructor) : [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function findType<T>(arr: object[] | undefined, genericConstructor: new (...args: any[]) => T): T | undefined {
    return arr && <T>arr.find((element) => element instanceof genericConstructor);
}
