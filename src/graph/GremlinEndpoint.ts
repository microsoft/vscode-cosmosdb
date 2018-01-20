/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseMeta, DocumentClient } from 'documentdb';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import CosmosDBManagementClient = require("azure-arm-cosmosdb");

export interface IGremlinEndpoint {
    endpoint: string;
    port: number;
}

export async function GetGremlinEndpoint(client: CosmosDBManagementClient, documentEndpoint: string, resourceGroup: string, account: string): Promise<IGremlinEndpoint> {
    let { preGAEndpoint, port } = parseDocumentEndpoint(documentEndpoint);

    return new Promise<IGremlinEndpoint>((resolve, reject) => {
        // Use the callback version of get because the Promise one currently doesn't expose gremlinEndpoint (https://github.com/Azure/azure-documentdb-node/issues/227)
        client.databaseAccounts.get(resourceGroup, account, (error, result, httpRequest, response) => {
            if (error) {
                reject(error);
            } else {
                let body = <{ properties: { gremlinEndpoint: string } }>JSON.parse((<any>response).body);
                let endpointUri = body.properties.gremlinEndpoint;
                let endpoint: IGremlinEndpoint = {
                    endpoint: endpointUri,
                    port: port
                };

                if (!endpointUri) {
                    // Must be a pre-GA account
                    endpoint.endpoint = preGAEndpoint;
                }

                resolve(endpoint);
            }
        });
    });
}

function parseDocumentEndpoint(documentEndpoint: string): { preGAEndpoint: string, port: number } {
    // Document endpoint: https://<graphname>.documents.azure.com:443/
    // Pre-GA gremlin endpoint format: <graphname>.graphs.azure.com
    let [, address, , portString] = documentEndpoint.match(/^[^:]+:\/\/([^:]+)(:([0-9]+))?\/?$/);
    let preGAEndpoint = address.replace(".documents.azure.com", ".graphs.azure.com");
    console.assert(preGAEndpoint.match(/\.graphs\.azure\.com$/), "Unexpected endpoint format");
    let port = parseInt(portString || "443");
    console.assert(port > 0, "Unexpected port");
    return { preGAEndpoint, port };
}
