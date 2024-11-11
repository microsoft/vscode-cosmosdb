/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoCluster, type Resource } from '@azure/arm-cosmosdb';

// Selecting only the properties used in the extension, but keeping an easy option to extend the model later and offer full coverage of MongoCluster
// '|' means that you can only access properties that are common to both types.
export type MongoClusterModel = (MongoCluster | ResourceModelInUse) & ResourceModelInUse;

interface ResourceModelInUse extends Resource {
    // from the original MongoCluster type
    id: string;
    name: string;

    administratorLoginPassword?: string;
    connectionString?: string;

    location?: string;
    serverVersion?: string;
    systemData?: {
        createdAt?: Date;
    };

    // moved from nodeGroupSpecs[0] to the top level
    // todo: check the spec learn more about the nodeGroupSpecs array
    sku?: string;
    nodeCount?: number;
    diskSize?: number;
    enableHa?: boolean;

    // introduced new properties
    resourceGroup?: string;
}
