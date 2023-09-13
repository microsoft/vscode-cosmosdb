/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from '@azure/arm-cosmosdb';


export let client: CosmosDBManagementClient;
export const resourceGroupsToDelete: string[] = [];
export const accountList: {} = {};
export const resourceGroupList: {} = {};
export enum AccountApi {
    MongoDB = 'MongoDB',
    Graph = 'Gremlin',
    Core = 'SQL'
}

export const longRunningTestsEnabled: boolean = false;
