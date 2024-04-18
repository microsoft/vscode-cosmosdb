/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";
import { appendExtensionUserAgent } from "@microsoft/vscode-azext-utils";
import * as https from "https";
import * as vscode from 'vscode';
import { ext } from "../extensionVariables";

// eslint-disable-next-line import/no-internal-modules
import { getSessionFromVSCode } from "@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode";

export type CosmosDBKeyCredential = {
    type: "key";
    key: string;
};

export type CosmosDBAuthCredential = {
    type: "auth";
};

export type CosmosDBCredential = CosmosDBKeyCredential | CosmosDBAuthCredential;

export function getCosmosKeyCredential(credentials: CosmosDBCredential[]): CosmosDBKeyCredential | undefined {
    return credentials.filter((cred): cred is CosmosDBKeyCredential => cred.type === "key")[0];
}

export function getCosmosAuthCredential(credentials: CosmosDBCredential[]): CosmosDBAuthCredential | undefined {
    return credentials.filter((cred): cred is CosmosDBAuthCredential => cred.type === "auth")[0];
}

export function getCosmosClient(
    endpoint: string,
    credentials: CosmosDBCredential[],
    isEmulator: boolean | undefined
): CosmosClient {
    const vscodeStrictSSL: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    const enableEndpointDiscovery: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.enableEndpointDiscovery);
    const connectionPolicy = { enableEndpointDiscovery: (enableEndpointDiscovery === undefined) ? true : enableEndpointDiscovery };

    const keyCred = getCosmosKeyCredential(credentials);
    const authCred = getCosmosAuthCredential(credentials);

    const commonProperties = {
        endpoint,
        userAgentSuffix: appendExtensionUserAgent(),
        agent: new https.Agent({ rejectUnauthorized: isEmulator ? !isEmulator : vscodeStrictSSL }),
        connectionPolicy
    };
    // @todo: Add telemetry to monitor usage of each credential type
    if (keyCred) {
        return new CosmosClient({
            ...commonProperties,
            key: keyCred.key
        });
    } else if (authCred) {
        return new CosmosClient({
            ...commonProperties,
            aadCredentials: {
                getToken: async (scopes, _options) => {
                    const session = await getSessionFromVSCode(scopes, undefined, { createIfNone: true });
                    return {
                        token: session?.accessToken ?? "",
                        expiresOnTimestamp: 0
                    };
                }
            }
        });
    } else {
        throw Error("No credential available to create CosmosClient.");
    }
}
