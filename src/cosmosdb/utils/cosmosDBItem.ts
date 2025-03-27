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
import { type CosmosDBItemIdentifier, type QueryResultRecord } from '../types/queryResult';

export const extractPartitionKey = (item: ItemDefinition, partitionKey: PartitionKeyDefinition): PartitionKey => {
    return partitionKey.paths.map((path): PrimitivePartitionKeyValue => {
        let interim: JSONValue = item;
        const partitionKeyPath = path.split('/').filter((key) => key !== '');

        for (const prop of partitionKeyPath) {
            if (interim && typeof interim === 'object' && interim[prop]) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                interim = interim[prop];
            } else {
                return null; // It is not correct to return null, in other cases it should be an exception
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
 * Get the unique id of an item only as a key for the UI (loops, tables, etc.)
 * @param record
 * @param partitionKey
 */
export const getCosmosDBItemIdentifier = (
    record: QueryResultRecord,
    partitionKey: PartitionKeyDefinition | undefined,
): CosmosDBItemIdentifier | undefined => {
    const itemId = {
        _rid: typeof record['_rid'] === 'string' ? record['_rid'] : undefined,
        id: record['id'],
        partitionKey: partitionKey ? extractPartitionKey(record, partitionKey) : undefined,
    };

    // The real unique id of the item is stored in the '_rid' field
    if (itemId._rid && typeof itemId._rid === 'string' && itemId._rid.length > 0) {
        return itemId;
    }

    // Next unique id is the partition key + id
    if (partitionKey) {
        if (Array.isArray(itemId.partitionKey) && itemId.partitionKey.some((key) => key === undefined)) {
            return undefined;
        }

        if (itemId.partitionKey === undefined) {
            return undefined;
        }
    }

    if (itemId.id && itemId.id.length > 0) {
        return itemId;
    }

    return undefined;
};
