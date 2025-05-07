/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents a tree element with a storage identifier.
 * This type is used to uniquely identify elements that can be persisted in storage.
 * @property storageId - A string identifier used to reference the element in storage
 */
export type TreeElementWithStorageId = {
    storageId: string;
};

/**
 * Type guard function to check if a given node is a `TreeElementWithStorageId`.
 *
 * @param node - The node to check.
 * @returns `true` if the node is an object and has a `storageId` property, otherwise `false`.
 */
export function isTreeElementWithStorageId(node: unknown): node is TreeElementWithStorageId {
    return typeof node === 'object' && node !== null && 'storageId' in node;
}
