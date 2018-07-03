/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { DocumentClient } from "documentdb";
import * as DocDBLib from 'documentdb/lib';
import { ext } from "../extensionVariables";
import { appendExtensionUserAgent } from "vscode-azureextensionui";

export function getDocumentClient(documentEndpoint: string, masterKey: string, isEmulator: boolean): DocumentClient {
    const documentBase = DocDBLib.DocumentBase;
    let connectionPolicy = new documentBase.ConnectionPolicy();

    let vscodeStrictSSL: boolean | undefined = vscode.workspace.getConfiguration().get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    let strictSSL = !isEmulator && vscodeStrictSSL;
    connectionPolicy.DisableSSLVerification = !strictSSL;
    const client = new DocumentClient(documentEndpoint, { masterKey: masterKey }, connectionPolicy);

    // User agent isn't formally exposed on the client (https://github.com/Azure/azure-documentdb-node/issues/244) but nevertheless can be accessed via defaultHeaders
    // tslint:disable-next-line:no-any
    let defaultHeaders = (<{ defaultHeaders: { "User-Agent"?: string } }><any>client).defaultHeaders;
    if (defaultHeaders) {
        let userAgent = appendExtensionUserAgent(defaultHeaders['User-Agent']);
        defaultHeaders['User-Agent'] = userAgent;
    }

    return client;
}
