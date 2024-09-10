/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzExtTreeItem,
    type ExecuteActivityContext,
    type IActionContext,
    type ISubscriptionContext,
} from '@microsoft/vscode-azext-utils';

export interface IDeleteWizardContext extends IActionContext, ExecuteActivityContext {
    node: AzExtTreeItem;
    deletePostgres: boolean;
    resourceGroupToDelete?: string;
    subscription: ISubscriptionContext;
}
