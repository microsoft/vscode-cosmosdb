/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { ServiceClientCredentials } from "ms-rest";
import { addExtensionUserAgent } from "vscode-azureextensionui";

export function getCosmosDBManagementClient(credentials: ServiceClientCredentials, subscriptionId: string, baseUri='https://management.azure.com/'): CosmosDBManagementClient {
    const client = new CosmosDBManagementClient(credentials, subscriptionId, baseUri);
    addExtensionUserAgent(client);

    return client;
}
