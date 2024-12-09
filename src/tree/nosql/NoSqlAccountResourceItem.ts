/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { CosmosAccountResourceItemBase } from '../CosmosAccountResourceItemBase';
import { type NoSqlAccountModel } from './NoSqlAccountModel';

export class NoSqlAccountResourceItem extends CosmosAccountResourceItemBase {
    constructor(
        account: NoSqlAccountModel,
        /**private*/ readonly subscription?: AzureSubscription, // optional for the case of a workspace connection | private commented out to keep the compiler happy for now
    ) {
        console.log(subscription ? subscription.subscriptionId : 'No subscription');
        super(account);
    }

    // here, we can add more methods or properties specific to MongoDB
}
