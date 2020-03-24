/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// tslint:disable-next-line:no-any
export function filterType<T>(arr: Object[] | undefined, genericConstructor: new (...args: any[]) => T): T[] {
    return arr ? <T[]>arr.filter(element => element instanceof genericConstructor) : [];
}

// tslint:disable-next-line:no-any
export function findType<T>(arr: Object[] | undefined, genericConstructor: new (...args: any[]) => T): T | undefined {
    return arr && <T>arr.find(element => element instanceof genericConstructor);
}
