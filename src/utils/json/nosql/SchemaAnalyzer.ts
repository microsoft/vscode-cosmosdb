/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is an example of a JSON Schema document that will be generated from NoSQL documents.
 * It's optimized for the use-case of generating a schema for a table view, the monaco editor, and schema statistics.
 *
 * This is a 'work in progress' and will be updated as we progress with the project.
 *
 * Curent focus is:
 *  - discovery of the document structure
 *  - basic pre for future statistics work
 *
 * Future tasks:
 *  - statistics aggregation
 *  - meaningful 'description' and 'markdownDescription'
 *  - add more properties to the schema, incl. properties like '$id', '$schema', and enable schema sharing/download
 *

{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://example.com/sample.schema.json",
  "title": "Sample Document Schema",
  "type": "object",
  "properties": {
    "a-propert-root-level": {
      "description": "a description as text",
      "anyOf": [ // anyOf is used to indicate that the value can be of any of the types listed
        {
          "type": "string"
        },
        {
          "type": "string"
        }
      ]
    },
    "isOpen": {
      "description": "Indicates if the item is open",
      "anyOf": [
        {
          "type": "boolean"
        },
        {
          "type": "number"
        }
      ]
    }
  },
  "required": ["isOpen"]
}

 *
 *
 */

import * as l10n from '@vscode/l10n';
import { assert } from 'console';
import Denque from 'denque';
import { type JSONSchema } from '../JSONSchema';
import { NoSQLTypes } from './NoSqlTypes';

export type NoSQLDocument = Record<string, NoSQLTypes>;

export function updateSchemaWithDocument(schema: JSONSchema, document: NoSQLDocument): void {
    // Initialize schema if it's empty
    if (!schema.properties) {
        schema.properties = {};
        schema['x-documentsInspected'] = 0;
    }

    schema['x-documentsInspected'] = (schema['x-documentsInspected'] ?? 0) + 1;

    // Define the structure of work items to be processed
    type WorkItem = {
        fieldName: string;
        fieldType: NoSQLTypes; // The inferred type
        propertySchema: JSONSchema; // Reference to the schema entry within 'properties'
        fieldValue: unknown;
        pathSoFar: string; // Used for debugging and tracing
    };

    // Initialize a FIFO queue for breadth-first traversal
    const fifoQueue: Denque<WorkItem> = new Denque();

    /**
     * Start by pushing all root-level elements of the document into the queue
     */
    for (const [name, value] of Object.entries(document)) {
        const datatype = NoSQLTypes.inferType(value);

        // Ensure the field exists in the schema
        if (!schema.properties[name]) {
            // Initialize the property schema if it doesn't exist
            schema.properties[name] = {
                anyOf: [],
                'x-occurrence': 0,
            };
        }

        const propertySchema: JSONSchema = schema.properties[name] as JSONSchema;
        assert(propertySchema !== undefined, 'propertySchema should not be undefined');

        // Increment the field occurrence count
        propertySchema['x-occurrence'] = (propertySchema['x-occurrence'] ?? 0) + 1;

        // Find or create the type entry in 'anyOf'
        let typeEntry = findTypeEntry(propertySchema.anyOf as JSONSchema[], datatype);

        if (!typeEntry) {
            // Create a new type entry
            typeEntry = {
                type: NoSQLTypes.toJSONType(datatype),
                'x-bsonType': datatype,
                'x-typeOccurrence': 0,
            };
            if (!propertySchema.anyOf) {
                propertySchema.anyOf = [];
            }
            propertySchema.anyOf.push(typeEntry);
        }

        // Increment the type occurrence count
        typeEntry['x-typeOccurrence'] = (typeEntry['x-typeOccurrence'] ?? 0) + 1;

        // Push a work item into the queue for further processing
        fifoQueue.push({
            fieldName: name,
            fieldType: datatype,
            propertySchema: typeEntry,
            fieldValue: value,
            pathSoFar: name,
        });
    }

    /**
     * Process items in the queue to build/update the schema
     * This is a breadth-first traversal of the document structure
     */
    while (fifoQueue.length > 0) {
        const item = fifoQueue.shift();
        if (item === undefined) {
            continue;
        }

        switch (item.fieldType) {
            case NoSQLTypes.Object: {
                const objValue = item.fieldValue as Record<string, unknown>;
                const objKeysCount = Object.keys(objValue).length;

                // Update min and max property counts
                updateMinMaxStats(item.propertySchema, 'x-minProperties', 'x-maxProperties', objKeysCount);

                // Ensure 'properties' exists
                if (!item.propertySchema.properties) {
                    item.propertySchema.properties = {};
                }

                // Iterate over the object's properties
                for (const [name, value] of Object.entries(objValue)) {
                    const datatype = NoSQLTypes.inferType(value);

                    // Ensure the field exists in the schema
                    if (!item.propertySchema.properties[name]) {
                        // Initialize the property schema if it doesn't exist
                        item.propertySchema.properties[name] = {
                            anyOf: [],
                            'x-occurrence': 0,
                        };
                    }

                    const propertySchema: JSONSchema = item.propertySchema.properties[name] as JSONSchema;
                    assert(propertySchema !== undefined, 'propertySchema should not be undefined');

                    // Increment the field occurrence count
                    propertySchema['x-occurrence'] = (propertySchema['x-occurrence'] ?? 0) + 1;

                    // Find or create the type entry in 'anyOf'
                    let typeEntry = findTypeEntry(propertySchema.anyOf as JSONSchema[], datatype);

                    if (!typeEntry) {
                        // Create a new type entry
                        typeEntry = {
                            type: NoSQLTypes.toJSONType(datatype),
                            'x-bsonType': datatype,
                            'x-typeOccurrence': 0,
                        };
                        if (!propertySchema.anyOf) {
                            propertySchema.anyOf = [];
                        }
                        propertySchema.anyOf.push(typeEntry);
                    }

                    // Increment the type occurrence count
                    typeEntry['x-typeOccurrence'] = (typeEntry['x-typeOccurrence'] ?? 0) + 1;

                    // Queue the property's value for further processing
                    fifoQueue.push({
                        fieldName: name,
                        fieldType: datatype,
                        propertySchema: typeEntry,
                        fieldValue: value,
                        pathSoFar: `${item.pathSoFar}.${name}`,
                    });
                }
                break;
            }

            case NoSQLTypes.Array: {
                const arrayValue = item.fieldValue as unknown[];
                const arrayLength = arrayValue.length;

                // Update min and max array lengths
                updateMinMaxStats(item.propertySchema, 'x-minItems', 'x-maxItems', arrayLength);

                // Ensure 'items' exists
                if (!item.propertySchema.items) {
                    item.propertySchema.items = {
                        anyOf: [],
                    };
                }

                const itemsSchema: JSONSchema = item.propertySchema.items as JSONSchema;
                assert(itemsSchema !== undefined, 'itemsSchema should not be undefined');

                // Map to track types within the array
                const encounteredMongoTypes: Map<NoSQLTypes, JSONSchema> = new Map();

                // Iterate over the array elements
                for (const element of arrayValue) {
                    const elementType = NoSQLTypes.inferType(element);

                    // Find or create the type entry in 'items.anyOf'
                    let itemEntry = findTypeEntry(itemsSchema.anyOf as JSONSchema[], elementType);

                    if (!itemEntry) {
                        // Create a new type entry
                        itemEntry = {
                            type: NoSQLTypes.toJSONType(elementType),
                            'x-bsonType': elementType,
                            'x-typeOccurrence': 0,
                        };
                        if (!itemsSchema.anyOf) {
                            itemsSchema.anyOf = [];
                        }
                        itemsSchema.anyOf.push(itemEntry);
                    }

                    // Increment the type occurrence count
                    itemEntry['x-typeOccurrence'] = (itemEntry['x-typeOccurrence'] ?? 0) + 1;

                    // Update stats for the element
                    if (!encounteredMongoTypes.has(elementType)) {
                        // First occurrence, initialize stats
                        initializeStatsForValue(element, elementType, itemEntry);
                        encounteredMongoTypes.set(elementType, itemEntry);
                    } else {
                        // Subsequent occurrences, aggregate stats
                        aggregateStatsForValue(element, elementType, itemEntry);
                    }

                    // If the element is an object or array, queue it for further processing
                    if (elementType === NoSQLTypes.Object || elementType === NoSQLTypes.Array) {
                        fifoQueue.push({
                            fieldName: '[]', // Array items don't have a specific field name
                            fieldType: elementType,
                            propertySchema: itemEntry,
                            fieldValue: element,
                            pathSoFar: `${item.pathSoFar}[]`,
                        });
                    }
                }
                break;
            }

            default: {
                // Update stats for the value
                if (item.propertySchema['x-typeOccurrence'] === 1) {
                    // First occurrence, initialize stats
                    initializeStatsForValue(item.fieldValue, item.fieldType, item.propertySchema);
                } else {
                    // Subsequent occurrences, aggregate stats
                    aggregateStatsForValue(item.fieldValue, item.fieldType, item.propertySchema);
                }
                break;
            }
        }
    }
}

/**
 * Helper function to find a type entry in 'anyOf' array based on 'x-bsonType'
 */
function findTypeEntry(anyOfArray: JSONSchema[], bsonType: NoSQLTypes): JSONSchema | undefined {
    return anyOfArray.find((entry) => entry['x-bsonType'] === bsonType);
}

/**
 * Helper function to update min and max stats
 */
function updateMinMaxStats(schema: JSONSchema, minKey: string, maxKey: string, value: number): void {
    if (schema[minKey] === undefined || value < schema[minKey]) {
        schema[minKey] = value;
    }
    if (schema[maxKey] === undefined || value > schema[maxKey]) {
        schema[maxKey] = value;
    }
}

export function getSchemaFromDocument(document: NoSQLDocument): JSONSchema {
    const schema: JSONSchema = {};
    schema['x-documentsInspected'] = 1; // we're inspecting one document, this will make sense when we start aggregating stats
    schema.properties = {};

    type WorkItem = {
        fieldName: string;
        fieldNoSQLType: NoSQLTypes; // the inferred BSON type
        propertyTypeEntry: JSONSchema; // points to the entry within the 'anyOf' property of the schema
        fieldValue: unknown;
        pathSoFar: string; // used for debugging
    };

    // having some import/require issues with Denque atm
    // prototype with an array
    //const fifoQueue = new Denque();
    const fifoQueue: WorkItem[] = [];

    /**
     * Push all elements from the root of the document into the queue
     */
    for (const [name, value] of Object.entries(document)) {
        const datatype = NoSQLTypes.inferType(value);

        const typeEntry = {
            type: NoSQLTypes.toJSONType(datatype),
            'x-bsonType': datatype,
            'x-typeOccurrence': 1,
        };

        // please note (1/2): we're adding the type entry to the schema here
        schema.properties[name] = { anyOf: [typeEntry], 'x-occurrence': 1 };

        fifoQueue.push({
            fieldName: name,
            fieldNoSQLType: datatype,
            propertyTypeEntry: typeEntry, // please note (2/2): and we're keeping a reference to it here for further updates
            fieldValue: value,
            pathSoFar: name,
        });
    }

    /**
     * Work through the queue, adding elements to the schema as we go.
     * This is a breadth-first search of the document, do note special
     * handling on objects/arrays
     */
    while (fifoQueue.length > 0) {
        const item = fifoQueue.shift(); // todo, replace with a proper queue
        if (item === undefined) {
            // unexpected, but let's try to continue
            continue;
        }

        switch (item.fieldNoSQLType) {
            case NoSQLTypes.Object: {
                const objKeys = Object.keys(item.fieldValue as object).length;
                item.propertyTypeEntry['x-maxLength'] = objKeys;
                item.propertyTypeEntry['x-minLength'] = objKeys;

                // prepare an entry for the object properties
                item.propertyTypeEntry.properties = {};

                for (const [name, value] of Object.entries(item.fieldValue as object)) {
                    const mongoDatatype = NoSQLTypes.inferType(value);

                    const typeEntry = {
                        type: NoSQLTypes.toJSONType(mongoDatatype),
                        'x-bsonType': mongoDatatype,
                        'x-typeOccurrence': 1,
                    };

                    // please note (1/2): we're adding the entry to the main schema here
                    item.propertyTypeEntry.properties[name] = { anyOf: [typeEntry], 'x-occurrence': 1 };

                    fifoQueue.push({
                        fieldName: name,
                        fieldNoSQLType: mongoDatatype,
                        propertyTypeEntry: typeEntry, // please note (2/2): and we're keeping a reference to it here for further updates to the schema
                        fieldValue: value,
                        pathSoFar: `${item.pathSoFar}.${item.fieldName}`,
                    });
                }
                break;
            }
            case NoSQLTypes.Array: {
                const arrayLength = (item.fieldValue as unknown[]).length;
                item.propertyTypeEntry['x-maxLength'] = arrayLength;
                item.propertyTypeEntry['x-minLength'] = arrayLength;

                // preapare the array items entry (in two lines for ts not to compalin about the missing type later on)
                item.propertyTypeEntry.items = {};
                item.propertyTypeEntry.items.anyOf = [];

                const encounteredMongoTypes: Map<NoSQLTypes, JSONSchema> = new Map();

                // iterate over the array and infer the type of each element
                for (const element of item.fieldValue as unknown[]) {
                    const elementMongoType = NoSQLTypes.inferType(element);

                    let itemEntry: JSONSchema;

                    if (!encounteredMongoTypes.has(elementMongoType)) {
                        itemEntry = {
                            type: NoSQLTypes.toJSONType(elementMongoType),
                            'x-bsonType': elementMongoType,
                            'x-typeOccurrence': 1, // Initialize type occurrence counter
                        };
                        item.propertyTypeEntry.items.anyOf.push(itemEntry);
                        encounteredMongoTypes.set(elementMongoType, itemEntry);

                        initializeStatsForValue(element, elementMongoType, itemEntry);
                    } else {
                        // if we've already encountered this type, we'll just add the type to the existing entry
                        itemEntry = encounteredMongoTypes.get(elementMongoType) as JSONSchema;

                        if (itemEntry === undefined) continue; // unexpected, but let's try to continue

                        if (itemEntry['x-typeOccurrence'] !== undefined) {
                            itemEntry['x-typeOccurrence'] += 1;
                        }

                        // Aggregate stats with the new value
                        aggregateStatsForValue(element, elementMongoType, itemEntry);
                    }

                    // an imporant exception for arrays as we have to start adding them already now to the schema
                    // (if we want to avoid more iterations over the data)
                    if (elementMongoType === NoSQLTypes.Object || elementMongoType === NoSQLTypes.Array) {
                        fifoQueue.push({
                            fieldName: '[]', // Array items don't have a field name
                            fieldNoSQLType: elementMongoType,
                            propertyTypeEntry: itemEntry,
                            fieldValue: element,
                            pathSoFar: `${item.pathSoFar}.${item.fieldName}.items`,
                        });
                    }
                }

                break;
            }

            default: {
                // For all other types, update stats for the value
                initializeStatsForValue(item.fieldValue, item.fieldNoSQLType, item.propertyTypeEntry);
                break;
            }
        }
    }

    return schema;
}

/**
 * Helper function to compute stats for a value based on its MongoDB data type
 * Updates the provided propertyTypeEntry with the computed stats
 */
function initializeStatsForValue(value: unknown, type: NoSQLTypes, propertyTypeEntry: JSONSchema): void {
    switch (type) {
        case NoSQLTypes.String: {
            const currentLength = (value as string).length;
            propertyTypeEntry['x-maxLength'] = currentLength;
            propertyTypeEntry['x-minLength'] = currentLength;
            break;
        }

        case NoSQLTypes.Number: {
            const numericValue = Number(value);
            propertyTypeEntry['x-maxValue'] = numericValue;
            propertyTypeEntry['x-minValue'] = numericValue;
            break;
        }

        case NoSQLTypes.Boolean: {
            const boolValue = value as boolean;
            propertyTypeEntry['x-trueCount'] = boolValue ? 1 : 0;
            propertyTypeEntry['x-falseCount'] = boolValue ? 0 : 1;
            break;
        }

        case NoSQLTypes.Null:
        case NoSQLTypes.Timestamp:
            // No stats computation for other types
            break;

        default:
            // No stats computation for other types
            break;
    }
}

/**
 * Helper function to aggregate stats for a value based on its MongoDB data type
 * Used when processing multiple values (e.g., elements in arrays)
 */
function aggregateStatsForValue(value: unknown, type: NoSQLTypes, propertyTypeEntry: JSONSchema): void {
    switch (type) {
        case NoSQLTypes.String: {
            const currentLength = (value as string).length;

            // Update minLength
            if (propertyTypeEntry['x-minLength'] === undefined || currentLength < propertyTypeEntry['x-minLength']) {
                propertyTypeEntry['x-minLength'] = currentLength;
            }

            // Update maxLength
            if (propertyTypeEntry['x-maxLength'] === undefined || currentLength > propertyTypeEntry['x-maxLength']) {
                propertyTypeEntry['x-maxLength'] = currentLength;
            }
            break;
        }

        case NoSQLTypes.Number: {
            const numericValue = Number(value);

            // Update minValue
            if (propertyTypeEntry['x-minValue'] === undefined || numericValue < propertyTypeEntry['x-minValue']) {
                propertyTypeEntry['x-minValue'] = numericValue;
            }

            // Update maxValue
            if (propertyTypeEntry['x-maxValue'] === undefined || numericValue > propertyTypeEntry['x-maxValue']) {
                propertyTypeEntry['x-maxValue'] = numericValue;
            }
            break;
        }

        case NoSQLTypes.Boolean: {
            const boolValue = value as boolean;

            // Update trueCount and falseCount
            if (propertyTypeEntry['x-trueCount'] === undefined) {
                propertyTypeEntry['x-trueCount'] = boolValue ? 1 : 0;
            } else {
                propertyTypeEntry['x-trueCount'] += boolValue ? 1 : 0;
            }

            if (propertyTypeEntry['x-falseCount'] === undefined) {
                propertyTypeEntry['x-falseCount'] = boolValue ? 0 : 1;
            } else {
                propertyTypeEntry['x-falseCount'] += boolValue ? 0 : 1;
            }
            break;
        }

        default:
            // No stats computation for other types
            break;
    }
}

function getSchemaAtPath(schema: JSONSchema, path: string[]): JSONSchema {
    let currentNode = schema;

    for (let i = 0; i < path.length; i++) {
        const key = path[i];

        // If the current node is an array, we should move to its `items`
        // if (currentNode.type === 'array' && currentNode.items) {
        //     currentNode = currentNode.items;
        // }

        // Move to the next property in the schema
        if (currentNode && currentNode.properties && currentNode.properties[key]) {
            const nextNode: JSONSchema = currentNode.properties[key] as JSONSchema;
            /**
             * Now, with our JSON Schema, there are "anyOf" entries that we need to consider.
             * We're looking at the "Object"-one, because these have the properties we're interested in.
             */
            if (nextNode.anyOf && nextNode.anyOf.length > 0) {
                currentNode = nextNode.anyOf.find((entry: JSONSchema) => entry.type === 'object') as JSONSchema;
            } else {
                // we can't continue, as we're missing the next node, we abort at the last node we managed to extract
                return currentNode;
            }
        } else {
            throw new Error(l10n.t('No properties found in the schema at path "{0}"', path.slice(0, i + 1).join('/')));
        }
    }

    return currentNode; // Return the node at the path
}

export function getPropertyNamesAtLevel(jsonSchema: JSONSchema, path: string[]): string[] {
    const headers = new Set<string>();

    // Explore the schema and apply the callback to collect headers at the specified path
    const selectedSchema: JSONSchema = getSchemaAtPath(jsonSchema, path);

    if (selectedSchema && selectedSchema.properties) {
        Object.keys(selectedSchema.properties).forEach((key) => {
            headers.add(key);
        });
    }

    return Array.from(headers).sort((a, b) => {
        if (a === '_id') return -1; // _id should come before b
        if (b === '_id') return 1; // _id should come after a
        return a.localeCompare(b); // regular sorting
    });
}

export function buildFullPaths(path: string[], propertyNames: string[]): string[] {
    return propertyNames.map((name) => path.concat(name).join('.'));
}
