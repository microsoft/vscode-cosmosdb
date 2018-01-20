/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseMeta, DocumentClient } from 'documentdb';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import CosmosDBManagementClient = require("azure-arm-cosmosdb");
import urlExists = require("url-exists");

//declare function urlExists(url: string, callback: (err: any, exists: boolean) => void);

export interface IGremlinEndpoint {
    endpoint: string;
    port: number;
}

export async function GetGremlinEndpointFromAzure(client: CosmosDBManagementClient, documentEndpoint: string, resourceGroup: string, account: string): Promise<IGremlinEndpoint> {
    return new Promise<IGremlinEndpoint>((resolve, reject) => {
        // Use the callback version of get because the Promise one currently doesn't expose gremlinEndpoint (https://github.com/Azure/azure-documentdb-node/issues/227)
        client.databaseAccounts.get(resourceGroup, account, (error, result, httpRequest, response) => {
            if (error) {
                reject(error);
            } else {
                let body = <{ properties: { gremlinEndpoint: string } }>JSON.parse((<any>response).body);
                let endpointUri = body.properties.gremlinEndpoint;
                if (endpointUri) {
                    resolve(parseDocEndpoint(endpointUri));
                } else {
                    // Pre-GA accounts don't have gremlinEndpoint in their properties, so parse them from the document endpoint.
                    // Eventually all accounts should have the gremlin endpoint in their properties.
                    resolve(getGremlinEndpointFromDocEndpoint(documentEndpoint));
                }
            }
        });
    });
}

export async function getGremlinEndpointFromDocEndpoint(documentEndpoint: string): Promise<IGremlinEndpoint> {
    let protocol = documentEndpoint.match(/https:/) ? 'https' : 'http';
    let endpoint1 = parseNewGremlinEndpointFromDocEndpoint(documentEndpoint);
    let endpoint2 = parseOldGremlinEndpointFromDocEndpoint(documentEndpoint);

    if (await doesUrlExist(`${protocol}://${endpoint1.endpoint}:${endpoint1.port}`)) {
        return endpoint1;
    } else {
        return endpoint2;
    }
}

function parseDocEndpoint(documentEndpoint: string): IGremlinEndpoint {
    // Endpoint from Azure: https://<graphname>.documents.azure.com:443/
    // Removes the https: and port to get the corresponding gremlin endpoint that we
    // need for our client:
    //   <graphname>.documents.azure.com
    // plus the port number
    let [, endpoint, , portString] = documentEndpoint.match(/^[^:]+:\/\/([^:]+)(:([0-9]+))?\/?$/);
    console.assert(!!endpoint, "Unexpected endpoint format");
    let port = parseInt(portString || "443");
    console.assert(port > 0, "Unexpected port");
    return { endpoint, port };
}

function parseNewGremlinEndpointFromDocEndpoint(documentEndpoint: string): IGremlinEndpoint {
    // Document endpoint: https://<graphname>.documents.azure.com:443/
    // New gremlin endpoint format: <graphname>.gremlin.cosmosdb.azure.com
    let endpoint = parseDocEndpoint(documentEndpoint);
    let preGAEndpoint = endpoint.endpoint.replace(".documents.azure.com", ".gremlin.cosmosdb.azure.com");
    console.assert(preGAEndpoint.match(/\.gremlin\.cosmosdb\.azure\.com$/), "Unexpected endpoint format");
    return { endpoint: preGAEndpoint, port: endpoint.port };
}

function parseOldGremlinEndpointFromDocEndpoint(documentEndpoint: string): IGremlinEndpoint {
    // Document endpoint: https://<graphname>.documents.azure.com:443/
    // Pre-GA gremlin endpoint format: <graphname>.graphs.azure.com
    let endpoint = parseDocEndpoint(documentEndpoint);
    let preGAEndpoint = endpoint.endpoint.replace(".documents.azure.com", ".graphs.azure.com");
    console.assert(preGAEndpoint.match(/\.graphs\.azure\.com$/), "Unexpected endpoint format");
    return { endpoint: preGAEndpoint, port: endpoint.port };
}

async function doesUrlExist(url: string): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
        urlExists(url, (err: any, exists: boolean) => {
            if (err) {
                reject(err);
            } else {
                resolve(exists);
            }
        });
    });
}
