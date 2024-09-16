/**
 * This is an example of a JSON Schema document that will be generated from MongoDB documents.
 * It's optimized for the use-case of generating a schema for a table view, the monaco editor, and schema statistics.
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

import { assert } from 'console';
import Denque from 'denque';
import {
    Binary,
    BSONSymbol,
    Code,
    DBRef,
    Decimal128,
    Double,
    Int32,
    Long,
    MaxKey,
    MinKey,
    ObjectId,
    Timestamp,
    type Document,
    type WithId,
} from 'mongodb';
import { type JSONSchema } from '../JSONSchema';
import { MongoDatatypes } from './MongoDatatypes';

export function updateSchemaWithDocument(schema: JSONSchema, document: WithId<Document>): void {
    // Initialize schema if it's empty
    if (!schema.properties) {
        schema.properties = {};
        schema['x-documentsInspected'] = 0;
    }

    schema['x-documentsInspected'] = (schema['x-documentsInspected'] ?? 0) + 1;

    // Define the structure of work items to be processed
    type WorkItem = {
        fieldName: string;
        fieldMongoType: MongoDatatypes; // The inferred BSON type
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
        const mongoDatatype = inferMongoType(value);

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
        let typeEntry = findTypeEntry(propertySchema.anyOf as JSONSchema[], mongoDatatype);

        if (!typeEntry) {
            // Create a new type entry
            typeEntry = {
                type: MongoDatatypes.toJSONType(mongoDatatype),
                'x-bsonType': mongoDatatype,
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
            fieldMongoType: mongoDatatype,
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

        switch (item.fieldMongoType) {
            case MongoDatatypes.Object: {
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
                    const mongoDatatype = inferMongoType(value);

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
                    let typeEntry = findTypeEntry(propertySchema.anyOf as JSONSchema[], mongoDatatype);

                    if (!typeEntry) {
                        // Create a new type entry
                        typeEntry = {
                            type: MongoDatatypes.toJSONType(mongoDatatype),
                            'x-bsonType': mongoDatatype,
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
                        fieldMongoType: mongoDatatype,
                        propertySchema: typeEntry,
                        fieldValue: value,
                        pathSoFar: `${item.pathSoFar}.${name}`,
                    });
                }
                break;
            }

            case MongoDatatypes.Array: {
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
                const encounteredMongoTypes: Map<MongoDatatypes, JSONSchema> = new Map();

                // Iterate over the array elements
                for (const element of arrayValue) {
                    const elementMongoType = inferMongoType(element);

                    // Find or create the type entry in 'items.anyOf'
                    let itemEntry = findTypeEntry(itemsSchema.anyOf as JSONSchema[], elementMongoType);

                    if (!itemEntry) {
                        // Create a new type entry
                        itemEntry = {
                            type: MongoDatatypes.toJSONType(elementMongoType),
                            'x-bsonType': elementMongoType,
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
                    if (!encounteredMongoTypes.has(elementMongoType)) {
                        // First occurrence, initialize stats
                        initializeStatsForValue(element, elementMongoType, itemEntry);
                        encounteredMongoTypes.set(elementMongoType, itemEntry);
                    } else {
                        // Subsequent occurrences, aggregate stats
                        aggregateStatsForValue(element, elementMongoType, itemEntry);
                    }

                    // If the element is an object or array, queue it for further processing
                    if (elementMongoType === MongoDatatypes.Object || elementMongoType === MongoDatatypes.Array) {
                        fifoQueue.push({
                            fieldName: '[]', // Array items don't have a specific field name
                            fieldMongoType: elementMongoType,
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
                    initializeStatsForValue(item.fieldValue, item.fieldMongoType, item.propertySchema);
                } else {
                    // Subsequent occurrences, aggregate stats
                    aggregateStatsForValue(item.fieldValue, item.fieldMongoType, item.propertySchema);
                }
                break;
            }
        }
    }
}

/**
 * Helper function to find a type entry in 'anyOf' array based on 'x-bsonType'
 */
function findTypeEntry(anyOfArray: JSONSchema[], bsonType: MongoDatatypes): JSONSchema | undefined {
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

export function getSchemaFromDocument(document: WithId<Document>): JSONSchema {
    const schema: JSONSchema = {};
    schema['x-documentsInspected'] = 1; // we're inspecting one document, this will make sense when we start aggregating stats
    schema.properties = {};

    type WorkItem = {
        fieldName: string;
        fieldMongoType: MongoDatatypes; // the inferred BSON type
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
        const mongoDatatype = inferMongoType(value);

        const typeEntry = {
            type: MongoDatatypes.toJSONType(mongoDatatype),
            'x-bsonType': mongoDatatype,
            'x-typeOccurrence': 1,
        };

        // please note (1/2): we're adding the type ntry to the schema here
        schema.properties[name] = { anyOf: [typeEntry], 'x-occurrence': 1 };

        fifoQueue.push({
            fieldName: name,
            fieldMongoType: mongoDatatype,
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

        switch (item.fieldMongoType) {
            case MongoDatatypes.Object: {
                const objKeys = Object.keys(item.fieldValue as object).length;
                item.propertyTypeEntry['x-maxLength'] = objKeys;
                item.propertyTypeEntry['x-minLength'] = objKeys;

                // prepare an entry for the object properties
                item.propertyTypeEntry.properties = {};

                for (const [name, value] of Object.entries(item.fieldValue as object)) {
                    const mongoDatatype = inferMongoType(value);

                    const typeEntry = {
                        type: MongoDatatypes.toJSONType(mongoDatatype),
                        'x-bsonType': mongoDatatype,
                        'x-typeOccurrence': 1,
                    };

                    // please note (1/2): we're adding the entry to the main schema here
                    item.propertyTypeEntry.properties[name] = { anyOf: [typeEntry], 'x-occurrence': 1 };

                    fifoQueue.push({
                        fieldName: name,
                        fieldMongoType: mongoDatatype,
                        propertyTypeEntry: typeEntry, // please note (2/2): and we're keeping a reference to it here for further updates to the schema
                        fieldValue: value,
                        pathSoFar: `${item.pathSoFar}.${item.fieldName}`,
                    });
                }
                break;
            }
            case MongoDatatypes.Array: {
                const arrayLength = (item.fieldValue as unknown[]).length;
                item.propertyTypeEntry['x-maxLength'] = arrayLength;
                item.propertyTypeEntry['x-minLength'] = arrayLength;

                // preapare the array items entry (in two lines for ts not to compalin about the missing type later on)
                item.propertyTypeEntry.items = {};
                item.propertyTypeEntry.items.anyOf = [];

                const encounteredMongoTypes: Map<MongoDatatypes, JSONSchema> = new Map();

                // iterate over the array and infer the type of each element
                for (const element of item.fieldValue as unknown[]) {
                    const elementMongoType = inferMongoType(element);

                    let itemEntry: JSONSchema;

                    if (!encounteredMongoTypes.has(elementMongoType)) {
                        itemEntry = {
                            type: MongoDatatypes.toJSONType(elementMongoType),
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
                    if (elementMongoType === MongoDatatypes.Object || elementMongoType === MongoDatatypes.Array) {
                        fifoQueue.push({
                            fieldName: '[]', // Array items don't have a field name
                            fieldMongoType: elementMongoType,
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
                initializeStatsForValue(item.fieldValue, item.fieldMongoType, item.propertyTypeEntry);
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
function initializeStatsForValue(value: unknown, mongoType: MongoDatatypes, propertyTypeEntry: JSONSchema): void {
    switch (mongoType) {
        case MongoDatatypes.String: {
            const currentLength = (value as string).length;
            propertyTypeEntry['x-maxLength'] = currentLength;
            propertyTypeEntry['x-minLength'] = currentLength;
            break;
        }

        case MongoDatatypes.Number:
        case MongoDatatypes.Int32:
        case MongoDatatypes.Long:
        case MongoDatatypes.Double:
        case MongoDatatypes.Decimal128: {
            const numericValue = Number(value);
            propertyTypeEntry['x-maxValue'] = numericValue;
            propertyTypeEntry['x-minValue'] = numericValue;
            break;
        }

        case MongoDatatypes.Boolean: {
            const boolValue = value as boolean;
            propertyTypeEntry['x-trueCount'] = boolValue ? 1 : 0;
            propertyTypeEntry['x-falseCount'] = boolValue ? 0 : 1;
            break;
        }

        case MongoDatatypes.Date: {
            const dateValue = (value as Date).getTime();
            propertyTypeEntry['x-maxDate'] = dateValue;
            propertyTypeEntry['x-minDate'] = dateValue;
            break;
        }

        case MongoDatatypes.Binary: {
            const binaryLength = (value as Buffer).length;
            propertyTypeEntry['x-maxLength'] = binaryLength;
            propertyTypeEntry['x-minLength'] = binaryLength;
            break;
        }

        case MongoDatatypes.Null:
        case MongoDatatypes.RegExp:
        case MongoDatatypes.ObjectId:
        case MongoDatatypes.MinKey:
        case MongoDatatypes.MaxKey:
        case MongoDatatypes.Symbol:
        case MongoDatatypes.Timestamp:
        case MongoDatatypes.DBRef:
        case MongoDatatypes.Map:
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
function aggregateStatsForValue(value: unknown, mongoType: MongoDatatypes, propertyTypeEntry: JSONSchema): void {
    switch (mongoType) {
        case MongoDatatypes.String: {
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

        case MongoDatatypes.Number:
        case MongoDatatypes.Int32:
        case MongoDatatypes.Long:
        case MongoDatatypes.Double:
        case MongoDatatypes.Decimal128: {
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

        case MongoDatatypes.Boolean: {
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

        case MongoDatatypes.Date: {
            const dateValue = (value as Date).getTime();

            // Update minDate
            if (propertyTypeEntry['x-minDate'] === undefined || dateValue < propertyTypeEntry['x-minDate']) {
                propertyTypeEntry['x-minDate'] = dateValue;
            }

            // Update maxDate
            if (propertyTypeEntry['x-maxDate'] === undefined || dateValue > propertyTypeEntry['x-maxDate']) {
                propertyTypeEntry['x-maxDate'] = dateValue;
            }
            break;
        }

        case MongoDatatypes.Binary: {
            const binaryLength = (value as Buffer).length;

            // Update minLength
            if (propertyTypeEntry['x-minLength'] === undefined || binaryLength < propertyTypeEntry['x-minLength']) {
                propertyTypeEntry['x-minLength'] = binaryLength;
            }

            // Update maxLength
            if (propertyTypeEntry['x-maxLength'] === undefined || binaryLength > propertyTypeEntry['x-maxLength']) {
                propertyTypeEntry['x-maxLength'] = binaryLength;
            }
            break;
        }

        default:
            // No stats computation for other types
            break;
    }
}

/**
 * Accepts a value from a MongoDB 'Document' object and returns the inferred type.
 * @param value The value of a field in a MongoDB 'Document' object
 * @returns
 */
function inferMongoType(value: unknown): MongoDatatypes {
    if (value === null) return MongoDatatypes.Null;
    if (value === undefined) return MongoDatatypes.Undefined;

    switch (typeof value) {
        case 'string':
            return MongoDatatypes.String;
        case 'number':
            return MongoDatatypes.Double; // JavaScript numbers are doubles
        case 'boolean':
            return MongoDatatypes.Boolean;
        case 'object':
            if (Array.isArray(value)) {
                return MongoDatatypes.Array;
            }

            // Check for common BSON types first
            if (value instanceof ObjectId) return MongoDatatypes.ObjectId;
            if (value instanceof Int32) return MongoDatatypes.Int32;
            if (value instanceof Double) return MongoDatatypes.Double;
            if (value instanceof Date) return MongoDatatypes.Date;
            if (value instanceof Timestamp) return MongoDatatypes.Timestamp;

            // Less common types
            if (value instanceof Decimal128) return MongoDatatypes.Decimal128;
            if (value instanceof Long) return MongoDatatypes.Long;
            if (value instanceof MinKey) return MongoDatatypes.MinKey;
            if (value instanceof MaxKey) return MongoDatatypes.MaxKey;
            if (value instanceof BSONSymbol) return MongoDatatypes.Symbol;
            if (value instanceof DBRef) return MongoDatatypes.DBRef;
            if (value instanceof Map) return MongoDatatypes.Map;
            if (value instanceof Buffer || value instanceof Binary) return MongoDatatypes.Binary;
            if (value instanceof RegExp) return MongoDatatypes.RegExp;
            if (value instanceof Code) {
                if (value.scope) {
                    return MongoDatatypes.CodeWithScope;
                } else {
                    return MongoDatatypes.Code;
                }
            }

            // Default to Object if none of the above match
            return MongoDatatypes.Object;
        default:
            // This should never happen, but if it does, we'll catch it here
            // TODO: add telemetry somewhere to know when it happens (not here, this could get hit too often)
            return MongoDatatypes._UNKNOWN_;
    }
}
