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
import { type CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { type MongoVCoreResourceItem } from '../../tree/azure-resources-view/documentdb/mongo-vcore/MongoVCoreResourceItem';

export interface DeleteWizardContext extends IActionContext, ExecuteActivityContext {
    node: AzExtTreeItem | CosmosDBAccountResourceItemBase | MongoVCoreResourceItem;
    subscription: ISubscriptionContext;
}
