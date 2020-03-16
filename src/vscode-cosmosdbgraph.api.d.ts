/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface CosmosDBGraphExtensionApi {
    apiVersion: string;

    openGraphExplorer(config: IGraphConfiguration): Promise<void>;
}

export interface IGremlinEndpoint {
    host: string;
    port: number;
    ssl: boolean;
}

export interface IGraphConfiguration {
    // e.g. https://graphaccount.documents.azure.com:443
    documentEndpoint: string;

    gremlinEndpoint?: IGremlinEndpoint;
    possibleGremlinEndpoints: IGremlinEndpoint[];

    key: string;
    databaseName: string;
    graphName: string;
    tabTitle: string;
}
