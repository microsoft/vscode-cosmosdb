/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type ItemDefinition,
    type JSONValue,
    type PartitionKey,
    type PartitionKeyDefinition,
    type PrimitivePartitionKeyValue,
} from '@azure/cosmos';
import { isEqual } from 'es-toolkit';
import { type CosmosDBRecordIdentifier, type QueryResultRecord } from '../cosmosdb/types/queryResult';

export const extractPartitionKey = (document: ItemDefinition, partitionKey: PartitionKeyDefinition): PartitionKey => {
    return partitionKey.paths.map((path): PrimitivePartitionKeyValue => {
        let interim: JSONValue = document;
        const partitionKeyPath = path.split('/').filter((key) => key !== '');

        for (const prop of partitionKeyPath) {
            // Use 'prop in interim' instead of 'interim[prop]' to check property existence
            // This ensures empty strings are treated as valid values (truthy check would fail)
            if (interim && typeof interim === 'object' && prop in interim) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                interim = interim[prop];
            } else {
                return null;
            }
        }
        if (
            interim === null ||
            typeof interim === 'string' ||
            typeof interim === 'number' ||
            typeof interim === 'boolean'
        ) {
            return interim;
        }

        return null;
    });
};

/**
 * Extract the partition key as key/value object from a document
 * @param document
 * @param partitionKey
 */
export const extractPartitionKeyValues = (
    document: ItemDefinition,
    partitionKey?: PartitionKeyDefinition,
): Record<string, PartitionKey> => {
    const partitionKeyValue: Record<string, PartitionKey> = {};

    if (!partitionKey) {
        return partitionKeyValue;
    }

    partitionKey.paths.forEach((path) => {
        const partitionKeyPath = path.split('/').filter((key) => key !== '');
        let interim: JSONValue = document;

        for (const prop of partitionKeyPath) {
            // Use 'prop in interim' instead of 'interim[prop]' to check property existence
            // This ensures empty strings are treated as valid values (truthy check would fail)
            if (interim && typeof interim === 'object' && prop in interim) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                interim = interim[prop];
            } else {
                return; // It is not correct to return null, in other cases it should be an exception
            }
        }
        if (
            interim === null ||
            typeof interim === 'string' ||
            typeof interim === 'number' ||
            typeof interim === 'boolean'
        ) {
            partitionKeyValue[path] = interim;
        }
    });

    return partitionKeyValue;
};

/**
 * Get the unique id of a document only as a key for the UI (loops, tables, etc.)
 * @param document
 * @param partitionKey
 */
export const getDocumentId = (
    document: QueryResultRecord,
    partitionKey: PartitionKeyDefinition | undefined,
): CosmosDBRecordIdentifier | undefined => {
    const documentId = {
        _rid: typeof document['_rid'] === 'string' ? document['_rid'] : undefined,
        id: document['id'],
        partitionKey: partitionKey ? extractPartitionKey(document, partitionKey) : undefined,
    };

    // The real unique id of the document is stored in the '_rid' field
    if (documentId._rid && typeof documentId._rid === 'string' && documentId._rid.length > 0) {
        return documentId;
    }

    // Next unique id is the partition key + id
    if (partitionKey) {
        if (Array.isArray(documentId.partitionKey) && documentId.partitionKey.some((key) => key === undefined)) {
            return undefined;
        }

        if (documentId.partitionKey === undefined) {
            return undefined;
        }
    }

    if (documentId.id && documentId.id.length > 0) {
        return documentId;
    }

    return undefined;
};

/**
 * Compare two partition key values for equality
 * @param pk1 First partition key value
 * @param pk2 Second partition key value
 * @returns true if partition keys are equal, false otherwise
 */
export const arePartitionKeysEqual = (pk1: PartitionKey | undefined, pk2: PartitionKey | undefined): boolean => {
    // Both undefined or null
    if (pk1 === pk2) {
        return true;
    }

    // One is undefined/null, the other isn't
    if (pk1 === undefined || pk2 === undefined || pk1 === null || pk2 === null) {
        return false;
    }

    // Use deep equality for comparison (handles arrays and primitive values)
    return isEqual(pk1, pk2);
};
