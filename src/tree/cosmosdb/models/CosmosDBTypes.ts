/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type ContainerDefinition,
    type DatabaseDefinition,
    type Resource,
    type StoredProcedureDefinition,
    type TriggerDefinition,
} from '@azure/cosmos';

/**
 * Represents a database with its resource metadata from Azure Cosmos DB.
 * This type combines the database definition with the resource properties like _rid, _self, _etag, etc.
 */

export type DatabaseResource = DatabaseDefinition & Resource;

/**
 * Represents a container with its resource metadata from Azure Cosmos DB.
 * This type combines the container definition with the resource properties like _rid, _self, _etag, etc.
 */
export type ContainerResource = ContainerDefinition & Resource;

/**
 * Represents a stored procedure with its resource metadata from Azure Cosmos DB.
 * This type combines the stored procedure definition with the resource properties like _rid, _self, _etag, etc.
 */
export type StoredProcedureResource = StoredProcedureDefinition & Resource;

/**
 * Represents a trigger with its resource metadata from Azure Cosmos DB.
 * This type combines the trigger definition with the resource properties like _rid, _self, _etag, etc.
 */
export type TriggerResource = TriggerDefinition & Resource;
