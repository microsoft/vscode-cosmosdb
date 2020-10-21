/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient } from "@azure/cosmos";
import * as DocDBLib from 'documentdb/lib';
import * as vscode from "vscode";
import { appendExtensionUserAgent } from "vscode-azureextensionui";
import { ext } from "../extensionVariables";

export function getDocumentClient(endpoint: string, key: string, isEmulator: boolean | undefined): CosmosClient {
    const documentBase = DocDBLib.DocumentBase;
    const connectionPolicy = new documentBase.ConnectionPolicy();

    const vscodeStrictSSL: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    const strictSSL = !isEmulator && vscodeStrictSSL;
    connectionPolicy.DisableSSLVerification = !strictSSL;
    const client = new CosmosClient({ endpoint, key, connectionPolicy });

    // User agent isn't formally exposed on the client (https://github.com/Azure/azure-documentdb-node/issues/244) but nevertheless can be accessed via defaultHeaders
    // tslint:disable-next-line:no-any
    const defaultHeaders = (<{ defaultHeaders: { "User-Agent"?: string } }><any>client).defaultHeaders;
    if (defaultHeaders) {
        const userAgent = appendExtensionUserAgent(defaultHeaders['User-Agent']);
        defaultHeaders['User-Agent'] = userAgent;
    }

    return client;
}
