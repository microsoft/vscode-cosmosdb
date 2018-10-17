
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionRoot } from "vscode-azureextensionui";

export interface IMongoTreeRoot extends ISubscriptionRoot {
    isEmulator: boolean;
}
