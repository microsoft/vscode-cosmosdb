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
import { type CosmosDbRecordIdentifier, type QueryResultRecord } from '../docdb/types/queryResult';

export const extractPartitionKey = (document: ItemDefinition, partitionKey: PartitionKeyDefinition): PartitionKey => {
    return partitionKey.paths.map((path): PrimitivePartitionKeyValue => {
        let interim: JSONValue = document;
        const partitionKeyPath = path.split('/').filter((key) => key !== '');

        for (const prop of partitionKeyPath) {
            if (interim && typeof interim === 'object' && interim[prop]) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                interim = interim[prop];
            } else {
                return null; // It is not correct to return null, in other cases it should exception
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

        return null; // It is not correct to return null, in other cases it should be an exception
    });
};

/**
 * Get the unique id of a document only as a key for the UI (loops, tables, etc.)
 * @param document
 * @param partitionKey
 */
export const getDocumentId = (
    document: QueryResultRecord,
    partitionKey: PartitionKeyDefinition | undefined,
): CosmosDbRecordIdentifier | undefined => {
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
