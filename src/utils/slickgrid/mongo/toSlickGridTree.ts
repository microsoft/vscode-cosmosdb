/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Document, type ObjectId, type WithId } from 'mongodb';
import { MongoBSONTypes } from '../../json/mongo/MongoBSONTypes';
import { valueToDisplayString } from '../../json/mongo/MongoValueFormatters';

/**
 * The data structure for a single node entry in the tree data structure for SlickGrid.
 *
 * @id - The unique identifier of the node, it's an internal field, has to be unique, won't be shown.
 * @parentId - The unique identifier of the parent node, it's an internal field, has to be unique, won't be shown.
 *
 * @field - The name of the field int the MongoDB document (to be shown to the user).
 * @value - The value of the field in the MongoDB document (to be shown to the user).
 * @type - The detected data type of the value in the MongoDB document (to be shown to the user).
 */
export type TreeData = { id: string; parentId: string | null; field: string; value: string; type: string };

/**
 * The data structure for a single column definition in the tree data structure for SlickGrid.
 * These entries are required to keep the actual structure of the data and the columns in sync
 */
export type TreeDataColumnDefinition = { id: string; name: string; field: string; minWidth: number };

const ARRAY_EXPANSION_LIMIT = 10; // allow array expansion only when the number of elements is less than this limit, TODO: move this to settings later

/**
 * Handling the conversion of an array of MongoDB documents to a tree structure for SlickGrid.
 *
 * @param documents an array of MongoDB documents to convert to a tree structure for SlickGrid.
 * @returns
 */
export function toSlickGridTree(documents: WithId<Document>[]): TreeData[] {
    const tree: TreeData[] = [];

    /**
     * adding a random element to the idPrefix to make sure that the IDs are unique
     * otherwise, while the data is being updated in the tree, the ID would be the
     * same and the tree would always update
     */
    const randomId = Date.now().toString().slice(-6);

    documents.forEach((doc, index) => {
        const documentTree = documentToSlickGridTree(doc, `${index}/${randomId}-`);
        tree.push(...documentTree);
    });

    return tree;
}

/**
 * Handling the conversion of a single document to a tree structure for SlickGrid.
 * Taking care of the nested objects and arrays. Basic preorder traversal with a stack.
 *
 * @param document - The MongoDB document to convert to a tree structure.
 * @param idPrefix - The prefix to use for the IDs of the entries in the tree data structure.
 *                   This is useful when converting multiple documents to tree structures.
 *                   The internal id generated with always be a string, converted from a number
 *                   that increments by one on each entry, but the prefix can be used to differentiate
 *                   between different documents in case you're merging them into a single tree later on.
 */
export function documentToSlickGridTree(document: WithId<Document>, idPrefix?: string): TreeData[] {
    const tree: TreeData[] = [];

    let localEntryId = 0; // starts with 0 on each document
    if (idPrefix === undefined || idPrefix === null) {
        idPrefix = '';
    }

    /**
     * Introducing an artificail root element with the value of the '_id' field of the document.
     * Next, all document fields at the top level (including the '_id' field) will be added as children of this root.
     */

    const rootId = `${idPrefix}${localEntryId}`; // localEntryId is always a 0 here

    // Handle document._id which could be null
    let idFieldValue: string;
    if (document._id === null) {
        idFieldValue = 'null';
    } else if (document._id?._bsontype === 'ObjectId') {
        idFieldValue = document._id.toString();
    } else {
        idFieldValue = JSON.stringify(document._id);
    }

    tree.push({
        id: rootId,
        field: idFieldValue,
        value: '{...}',
        type: 'Document',
        parentId: null,
    });

    const stack: { key: string; value: unknown; parentId: string | null }[] = Object.entries(document).map(
        ([key, value]) => ({
            parentId: rootId,
            key: key,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- the value can be anything here as it comes from a MongoDB document
            value: value,
        }),
    );

    while (stack.length > 0) {
        localEntryId++;
        const globalEntryId = `${idPrefix}${localEntryId}`; // combines the global prefix with the local id

        const stackEntry = stack.pop();
        if (!stackEntry) {
            continue;
        }

        const dataType: MongoBSONTypes = MongoBSONTypes.inferType(stackEntry.value);

        switch (dataType) {
            case MongoBSONTypes.Object: {
                tree.push({
                    id: globalEntryId,
                    field: `${stackEntry.key}`,
                    value: `{...}`,
                    type: 'Object',
                    parentId: stackEntry.parentId,
                });

                // Add the properties of the object to the stack
                Object.entries(stackEntry.value as ObjectId).map(([key, value]) => {
                    stack.push({ key: `${key}`, value: value, parentId: globalEntryId });
                });
                break;
            }
            case MongoBSONTypes.Array: {
                const value = stackEntry.value as unknown[];

                tree.push({
                    id: globalEntryId,
                    field: `${stackEntry.key}`,
                    value: `(elements: ${value.length})`,
                    type: 'Array',
                    parentId: stackEntry.parentId,
                });

                if (value.length <= ARRAY_EXPANSION_LIMIT) {
                    // Add the elements of the array to the stack
                    value.forEach((element, index) => {
                        stack.push({ key: `${stackEntry.key}[${index}]`, value: element, parentId: globalEntryId });
                    });
                }
                break;
            }

            default: {
                // over time, this generic case should never be called once we cover all BSON types
                tree.push({
                    id: globalEntryId,
                    field: `${stackEntry.key}`,
                    value: valueToDisplayString(stackEntry.value, dataType),
                    type: MongoBSONTypes.toDisplayString(MongoBSONTypes.inferType(stackEntry.value)),
                    parentId: stackEntry.parentId,
                });
                break;
            }
        }
    }

    return tree;
}
