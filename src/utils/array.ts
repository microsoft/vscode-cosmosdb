/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function removeDuplicatesById<T extends { id: string }>(entries: T[]): T[] {
    const mapById = new Map<string, T>();
    entries.forEach(n => {
        mapById.set(n.id, n);
    });

    return [...mapById.values()];
}

// tslint:disable-next-line:no-any
export function filterType<T>(arr: Object[], genericConstructor: new(...args: any[]) => T): T[] {
    return <T[]>arr.filter(element => element instanceof genericConstructor);
}

// tslint:disable-next-line:no-any
export function findType<T>(arr: Object[], genericConstructor: new(...args: any[]) => T): T {
    return <T>arr.find(element => element instanceof genericConstructor);
}
