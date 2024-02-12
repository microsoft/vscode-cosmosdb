/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function joinNodeId(parentId: string, ...childIds: string[]): string {
    // @todo: discuss the node id with other engineers
    return [parentId, ...childIds].join("|-|");
}
