/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";
import { appendExtensionUserAgent } from "vscode-azureextensionui";

export function getCosmosClient(endpoint: string, key: string): CosmosClient {
    return new CosmosClient({ endpoint, key, userAgentSuffix: appendExtensionUserAgent() });
}
