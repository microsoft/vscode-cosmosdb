/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";
import { getConfiguredAuthProviderId } from "@microsoft/vscode-azext-azureauth";
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
};

export type CosmosDBCredential = CosmosDBKeyCredential | CosmosDBAuthCredential;

/**
 * Duplicated from @microsoft/vscode-azext-azureauth
 * @todo: Use the subscription client once it supports customizing scopes.
 */
export async function getSessionFromVSCode(scopes: string | string[], options?: vscode.AuthenticationGetSessionOptions): Promise<vscode.AuthenticationSession | undefined> {
    const scopesArray = typeof scopes === "string" ? [scopes] : scopes;
    return await vscode.authentication.getSession(getConfiguredAuthProviderId(), scopesArray, options);
}

export function getCosmosClient(
    endpoint: string,
    credentials: CosmosDBCredential[],
    isEmulator: boolean | undefined
): CosmosClient {
    const vscodeStrictSSL: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    const enableEndpointDiscovery: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.enableEndpointDiscovery);
    const connectionPolicy = { enableEndpointDiscovery: (enableEndpointDiscovery === undefined) ? true : enableEndpointDiscovery };

    const keyCred = credentials.filter((cred): cred is CosmosDBKeyCredential => cred.type === "key")[0];
    const authCred = credentials.filter((cred): cred is CosmosDBAuthCredential => cred.type === "auth")[0];

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
                    const session = await getSessionFromVSCode(scopes, { createIfNone: true });
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
