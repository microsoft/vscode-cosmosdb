/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";
import * as https from "https";
import * as vscode from 'vscode';
import { appendExtensionUserAgent } from "vscode-azureextensionui";
import { ext } from "../extensionVariables";

export function getCosmosClient(endpoint: string, key: string, isEmulator: boolean | undefined): CosmosClient {

    const vscodeStrictSSL: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    const strictSSL = !isEmulator && vscodeStrictSSL;
    return new CosmosClient({ endpoint, key, userAgentSuffix: appendExtensionUserAgent(), agent: new https.Agent({ rejectUnauthorized: !strictSSL }) });

}
