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
import { type MongoClusterResourceItem } from '../../mongoClusters/tree/MongoClusterResourceItem';
import { type CosmosAccountResourceItemBase } from '../../tree/CosmosAccountResourceItemBase';

export interface DeleteWizardContext extends IActionContext, ExecuteActivityContext {
    node: AzExtTreeItem | CosmosAccountResourceItemBase | MongoClusterResourceItem;
    deletePostgres: boolean;
    resourceGroupToDelete?: string;
    subscription: ISubscriptionContext;
}
