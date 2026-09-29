/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDefaultHttpClient, type HttpClient } from '@azure/core-rest-pipeline';

export function createCosmosHttpClient(strictSSL = true): HttpClient {
    const client = createDefaultHttpClient();
    return {
        sendRequest(request) {
            // Cosmos defaults to agents with keepAlive: true and, for HTTPS, minVersion: 'TLSv1.2':
            // https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/cosmosdb/cosmos/src/request/defaultAgent.ts
            // Azure's HTTP transport also supplies an agent when none is provided. Clear the final Node agent
            // option so VS Code's http.proxySupport=on can manage routing, while retaining the TLS 1.2 minimum.
            request.requestOverrides = {
                minVersion: 'TLSv1.2',
                // Preserve the destination TLS opt-out introduced for intercepting proxies in #562.
                rejectUnauthorized: strictSSL,
                ...request.requestOverrides,
                agent: undefined,
            };
            return client.sendRequest(request);
        },
    };
}
