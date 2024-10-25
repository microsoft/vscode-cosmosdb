/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Denque from 'denque';
import { type JSONSchema } from '../../JSONSchema';

export interface FieldEntry {
    path: string;
    type: string;
}

/**
 * This function traverses our JSON Schema object and collects all leaf property paths
 * along with their most common data types.
 *
 * This information is needed for auto-completion support
 *
 * The approach is as follows:
 * - Initialize a queue with the root properties of the schema to perform a breadth-first traversal.
 * - While the queue is not empty:
 *   - Dequeue the next item, which includes the current schema node and its path.
 *   - Determine the most common type for the current node by looking at the 'x-typeOccurrence' field.
 *   - If the most common type is an object with properties:
 *     - Enqueue its child properties with their updated paths into the queue for further traversal.
 *   - Else if the most common type is a leaf type (e.g., string, number, boolean):
 *     - Add the current path and type to the result array as it represents a leaf property.
 * - Continue this process until all nodes have been processed.
 * - Return the result array containing objects with 'path' and 'type' for each leaf property.
 */
export function getKnownFields(schema: JSONSchema): FieldEntry[] {
    const result: Array<{ path: string; type: string }> = [];
    type QueueItem = {
        path: string;
        schemaNode: JSONSchema;
    };

    const queue: Denque<QueueItem> = new Denque();

    // Initialize the queue with root properties
    if (schema.properties) {
        for (const propName of Object.keys(schema.properties)) {
            const propSchema = schema.properties[propName] as JSONSchema;
            queue.push({ path: propName, schemaNode: propSchema });
        }
    }

    while (queue.length > 0) {
        const item = queue.shift();
        if (!item) continue;

        const { path, schemaNode } = item;
        const mostCommonTypeEntry = getMostCommonTypeEntry(schemaNode);

        if (mostCommonTypeEntry) {
            if (mostCommonTypeEntry.type === 'object' && mostCommonTypeEntry.properties) {
                // Not a leaf node, enqueue its properties
                for (const childName of Object.keys(mostCommonTypeEntry.properties)) {
                    const childSchema = mostCommonTypeEntry.properties[childName] as JSONSchema;
                    queue.push({ path: `${path}.${childName}`, schemaNode: childSchema });
                }
            } else {
                // Leaf node, add to result
                result.push({ path: path, type: mostCommonTypeEntry.type as string });
            }
        }
    }

    return result;
}

/**
 * Helper function to get the most common type entry from a schema node.
 * It looks for the 'anyOf' array and selects the type with the highest 'x-typeOccurrence'.
 */
function getMostCommonTypeEntry(schemaNode: JSONSchema): JSONSchema | null {
    if (schemaNode.anyOf && schemaNode.anyOf.length > 0) {
        let maxOccurrence = -1;
        let mostCommonTypeEntry: JSONSchema | null = null;

        for (const typeEntry of schemaNode.anyOf as JSONSchema[]) {
            const occurrence = typeEntry['x-typeOccurrence'] || 0;
            if (occurrence > maxOccurrence) {
                maxOccurrence = occurrence;
                mostCommonTypeEntry = typeEntry;
            }
        }
        return mostCommonTypeEntry;
    } else if (schemaNode.type) {
        // If 'anyOf' is not present, use the 'type' field directly
        return schemaNode;
    }
    return null;
}
