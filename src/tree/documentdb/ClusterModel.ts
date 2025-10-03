/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type MongoClusterProperties, type Resource } from '@azure/arm-mongocluster';
import { type Experience } from '../../AzureDBExperiences';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';

// Selecting only the properties used in the extension, but keeping an easy option to extend the model later and offer full coverage of MongoCluster
// '|' means that you can only access properties that are common to both types.
export type ClusterModel = (MongoClusterProperties | ResourceModelInUse) & ResourceModelInUse;

/**
 * Represents a cluster model that has been attached to the workspace
 */
export type AttachedClusterModel = ClusterModel & {
    /**
     * ID used to reference this attached cluster in storage
     */
    storageId: string;
};

interface ResourceModelInUse extends Resource {
    // from the original MongoClusterProperties type
    id: string;
    name: string;

    administratorLoginPassword?: string;

    /**
     * This connection string does not contain user credentials.
     */
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

    // adding support for MongoRU and vCore
    dbExperience: Experience;

    /**
     * Indicates whether the account is an emulator.
     *
     * This property is set when an account is being added to the workspace.
     * We use it to filter the list of accounts when displaying them.
     * Also, sometimes we need to know if the account is an emulator to show/hide some UI elements.
     */
    emulatorConfiguration?: EmulatorConfiguration;
}
