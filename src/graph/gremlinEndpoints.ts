/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import CosmosDBManagementClient = require("azure-arm-cosmosdb");

export interface IGremlinEndpoint {
    host: string;
    port: number;
    ssl: boolean;
}

export async function TryGetGremlinEndpointFromAzure(client: CosmosDBManagementClient, resourceGroup: string, account: string): Promise<IGremlinEndpoint | undefined> {
    return new Promise<IGremlinEndpoint>((resolve, reject) => {
        // Use the callback version of get because the Promise one currently doesn't expose gremlinEndpoint (https://github.com/Azure/azure-documentdb-node/issues/227)
        client.databaseAccounts.get(resourceGroup, account, (error, result, httpRequest, response) => {
            if (error) {
                reject(error);
            } else {
                let body = <{ properties: { gremlinEndpoint: string } }>JSON.parse((<any>response).body);
                let endpointUri = body.properties.gremlinEndpoint;
                if (endpointUri) {
                    resolve(parseEndpointUrl(endpointUri));
                } else {
                    // If it doesn't have gremlinEndpoint in its properties, it must be a pre-GA endpoint
                    resolve(undefined);
                }
            }
        });
    });
}

export function getPossibleGremlinEndpoints(documentEndpoint: string): IGremlinEndpoint[] {
    // E.g., given a document endpoint from Azure such as https://<graphname>.documents.azure.com:443/

    const documentSuffix = '.documents.azure.com';
    if (documentEndpoint.indexOf(documentSuffix) >= 0) {
        // Pre-GA style (Dec 2017)
        const preGAEndpoint = documentEndpoint.replace(documentSuffix, '.graphs.azure.com');

        // Post-GA style (Dec 2017)
        const postGAEndpoint = documentEndpoint.replace(documentSuffix, '.gremlin.cosmosdb.azure.com');

        return [parseEndpointUrl(postGAEndpoint), parseEndpointUrl(preGAEndpoint)];
    } else {
        console.warn(`Unexpected document URL format: ${documentEndpoint}`);
        return [parseEndpointUrl(documentEndpoint)];
    }
}

/**
 * Parses a IGremlinPoint from a URL
 * @param url An account URL such as 'https://<graphname>.documents.azure.com:443/'
 */
function parseEndpointUrl(url: string): IGremlinEndpoint {
    let [, protocol, host, , portString] = url.match(/^([^:]+):\/\/([^:]+)(:([0-9]+))?\/?$/);
    console.assert(!!protocol && !!host, "Unexpected endpoint format");
    let port = parseInt(portString || "443");
    console.assert(port > 0, "Unexpected port");
    return { host, port, ssl: protocol.toLowerCase() === "https" };
}
