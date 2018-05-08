/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function removeDuplicatesById<T extends { id: string }>(entries: T[]): T[] {
    let mapById = new Map<string, T>();
    entries.forEach(n => {
        mapById.set(n.id, n);
    });

    return [...mapById.values()];
}
