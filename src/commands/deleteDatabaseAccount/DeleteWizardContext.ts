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
import { type CosmosDBAccountResourceItemBase } from '../../tree/CosmosDBAccountResourceItemBase';

export interface DeleteWizardContext extends IActionContext, ExecuteActivityContext {
    node: AzExtTreeItem | CosmosDBAccountResourceItemBase | MongoClusterResourceItem;
    subscription: ISubscriptionContext;
}
