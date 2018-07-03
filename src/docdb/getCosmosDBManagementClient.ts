/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addExtensionUserAgent } from "vscode-azureextensionui";
import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { ServiceClientCredentials } from "ms-rest";

export function getCosmosDBManagementClient(credentials: ServiceClientCredentials, subscriptionId: string): CosmosDBManagementClient {
    const client = new CosmosDBManagementClient(credentials, subscriptionId);
    addExtensionUserAgent(client);

    return client;
}
