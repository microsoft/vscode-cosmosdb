/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";
import { appendExtensionUserAgent } from "@microsoft/vscode-azext-utils";
import * as https from "https";
import * as vscode from 'vscode';
import { ext } from "../extensionVariables";

export function getCosmosClient(endpoint: string, key: string, isEmulator: boolean | undefined): CosmosClient {
    const vscodeStrictSSL: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    const enableEndpointDiscovery: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.enableEndpointDiscovery);
    const connectionPolicy = { enableEndpointDiscovery: (enableEndpointDiscovery === undefined) ? true : enableEndpointDiscovery };
    return new CosmosClient({ endpoint, key, userAgentSuffix: appendExtensionUserAgent(), agent: new https.Agent({ rejectUnauthorized: isEmulator ? !isEmulator : vscodeStrictSSL }), connectionPolicy: connectionPolicy });

}
