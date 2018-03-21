/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentClient } from "documentdb";
import * as DocDBLib from 'documentdb/lib';

export function getDocumentClient(documentEndpoint: string, masterKey: string, isEmulator: boolean): DocumentClient {
    const documentBase = DocDBLib.DocumentBase;
    var connectionPolicy = new documentBase.ConnectionPolicy();
    connectionPolicy.DisableSSLVerification = isEmulator;
    const client = new DocumentClient(documentEndpoint, { masterKey: masterKey }, connectionPolicy);
    return client;
}
