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

export const getDocumentId = (document: ItemDefinition, partitionKey: PartitionKeyDefinition | undefined): string => {
    // The real unique id of the document is stored in the '_rid' field
    if (document['_rid']) {
        return `${document['_rid']}`;
    } else if (partitionKey) {
        // Next unique id is the partition key + id
        const partitionKeyValue = extractPartitionKey(document, partitionKey);
        if (Array.isArray(partitionKeyValue)) {
            return `${partitionKeyValue.join('-')}-${document.id}`;
        }

        return `${partitionKeyValue}-${document.id}`;
    } else {
        // Last resort is just the id
        return `${document.id}`;
    }
};
