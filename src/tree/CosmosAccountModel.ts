/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Resource } from '@azure/arm-cosmosdb';
import { type API } from '../AzureDBExperiences';

export interface CosmosAccountModel extends Resource {
    id: string;
    name: string;

    dbExperience: API;
}
