
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentClient } from "documentdb";
import { ISubscriptionRoot } from "vscode-azureextensionui";

export interface IDocDBTreeRoot extends ISubscriptionRoot {
    documentEndpoint: string;
    masterKey: string;
    isEmulator: boolean;
    getDocumentClient(): DocumentClient;
}
