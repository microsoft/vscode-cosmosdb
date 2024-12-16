/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type GenericResource } from '@azure/arm-resources';
import { type AzureResource } from '@microsoft/vscode-azureresources-api';
import { type Experience } from '../AzureDBExperiences';

/**
 * Cosmos DB resource
 * Azure Resource group library mixes the raw generic resource into AzureResource
 * Therefore, we can access the raw generic resource from the CosmosDBResource
 * However, ideally we have to use raw property to access to the Cosmos DB resource
 */
export type CosmosDBResource = AzureResource &
    GenericResource & {
        readonly raw: GenericResource; // Resource object from Azure SDK
    };

export interface CosmosAccountModel extends CosmosDBResource {
    dbExperience: Experience; // Cosmos DB Experience
}
