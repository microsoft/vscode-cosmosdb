/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";
import { AzureDeveloperCliCredential } from "@azure/identity";
import { appendExtensionUserAgent } from "@microsoft/vscode-azext-utils";
import * as https from "https";
import * as vscode from 'vscode';
import { ext } from "../extensionVariables";

export type CosmosDBKeyCredential = {
    type: "key";
    key: string;
};
export type CosmosDBAuthCredential = {
    type: "auth";
}
export type CosmosDBCredential = CosmosDBKeyCredential | CosmosDBAuthCredential;

export function getCosmosClient(
    endpoint: string,
    cosmosDBCredentials: CosmosDBCredential[],
    isEmulator: boolean | undefined,
): CosmosClient {
    const vscodeStrictSSL: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    const enableEndpointDiscovery: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.enableEndpointDiscovery);
    const connectionPolicy = { enableEndpointDiscovery: (enableEndpointDiscovery === undefined) ? true : enableEndpointDiscovery };

    const keyCred = cosmosDBCredentials.filter((cred): cred is CosmosDBKeyCredential => cred.type === "key")[0];
    const authCred = cosmosDBCredentials.filter((cred): cred is CosmosDBAuthCredential => cred.type === "auth")[0];

    // @todo: Add telemetry to see how many code paths use key vs. auth
    if (keyCred) {
        return new CosmosClient({
            endpoint,
            key: keyCred.key,
            userAgentSuffix: appendExtensionUserAgent(),
            agent: new https.Agent({ rejectUnauthorized: isEmulator ? !isEmulator : vscodeStrictSSL }),
            connectionPolicy: connectionPolicy
        });
    } else if (authCred) {
        return new CosmosClient({
            endpoint,
            aadCredentials: new AzureDeveloperCliCredential(),
            userAgentSuffix: appendExtensionUserAgent(),
            agent: new https.Agent({ rejectUnauthorized: isEmulator ? !isEmulator : vscodeStrictSSL }),
            connectionPolicy: connectionPolicy
        });
    } else {
        throw Error("No credentials available to create CosmosClient");
    }
}
