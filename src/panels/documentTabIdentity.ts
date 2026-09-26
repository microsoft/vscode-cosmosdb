/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { type CosmosDBRecordIdentifier } from '../cosmosdb/types/queryResult';
import { arePartitionKeysEqual } from '../utils/document';

export const isSameDocumentTab = (
    firstConnection: NoSqlQueryConnection,
    firstDocument: CosmosDBRecordIdentifier,
    secondConnection: NoSqlQueryConnection,
    secondDocument: CosmosDBRecordIdentifier,
): boolean => {
    if (
        firstConnection.endpoint !== secondConnection.endpoint ||
        firstConnection.databaseId !== secondConnection.databaseId ||
        firstConnection.containerId !== secondConnection.containerId
    ) {
        return false;
    }

    if (firstDocument._rid && secondDocument._rid) {
        return firstDocument._rid === secondDocument._rid;
    }

    return (
        firstDocument.id !== undefined &&
        firstDocument.id === secondDocument.id &&
        arePartitionKeysEqual(firstDocument.partitionKey, secondDocument.partitionKey)
    );
};
