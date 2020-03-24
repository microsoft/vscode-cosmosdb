
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISubscriptionContext } from "vscode-azureextensionui";

export interface IMongoTreeRoot extends ISubscriptionContext {
    isEmulator: boolean | undefined;
}
