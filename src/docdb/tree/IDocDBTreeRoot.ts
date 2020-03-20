
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentClient } from "documentdb";
import { ISubscriptionContext } from "vscode-azureextensionui";

export interface IDocDBTreeRoot extends ISubscriptionContext {
    documentEndpoint: string;
    masterKey: string;
    isEmulator: boolean | undefined;
    getDocumentClient(): DocumentClient;
}
