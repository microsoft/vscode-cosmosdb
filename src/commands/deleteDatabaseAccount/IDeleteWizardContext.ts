/*---------------------------------------------------------------------------------------------
*  Copyright (c) Microsoft Corporation. All rights reserved.
*  Licensed under the MIT License. See License.txt in the project root for license information.
*--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, ExecuteActivityContext, IActionContext } from "@microsoft/vscode-azext-utils";
import { ISubscriptionContext } from "vscode-azureextensiondev";

export interface IDeleteWizardContext extends IActionContext, ExecuteActivityContext {
    node: AzExtTreeItem;
    deletePostgres: boolean;
    resourceGroupToDelete?: string;
    subscription: ISubscriptionContext;
}
