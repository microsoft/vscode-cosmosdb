/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";
import { appendExtensionUserAgent } from "vscode-azureextensionui";

export function getCosmosClient(endpoint: string, key: string): CosmosClient {
    const client = new CosmosClient({ endpoint, key });

    // User agent isn't formally exposed on the client (https://github.com/Azure/azure-documentdb-node/issues/244) but nevertheless can be accessed via defaultHeaders
    // tslint:disable-next-line:no-any
    let userAgentSuffix: String = (<{ userAgentSuffix: String }><any>client).userAgentSuffix;
    if (userAgentSuffix) {
        const userAgent = appendExtensionUserAgent(userAgentSuffix.toString());
        userAgentSuffix = userAgent;
    }

    return client;
}
