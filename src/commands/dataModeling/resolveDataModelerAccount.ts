/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { type DataModelerAccount } from '../../services/DataModelerProjectService';
import { getAccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { type CosmosDBAccountAttachedResourceItem } from '../../tree/cosmosdb/CosmosDBAccountAttachedResourceItem';
import { type CosmosDBAccountResourceItem } from '../../tree/cosmosdb/CosmosDBAccountResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export type DataModelerAccountSource =
    | DataModelerAccount
    | CosmosDBAccountResourceItem
    | CosmosDBAccountAttachedResourceItem;

export async function resolveDataModelerAccount(
    context: IActionContext,
    source?: DataModelerAccountSource,
): Promise<DataModelerAccount | undefined> {
    source ??= await pickAppResource<CosmosDBAccountResourceItem | CosmosDBAccountAttachedResourceItem>(context, {
        type: [AzExtResourceType.AzureCosmosDb],
    });
    if (!source) {
        return undefined;
    }
    const account = 'endpoint' in source ? source : await getAccountInfo(source.account);
    if (account.endpoint.trim()) {
        context.valuesToMask.push(account.endpoint);
    }
    if (account.name?.trim()) {
        context.valuesToMask.push(account.name);
    }
    return { endpoint: account.endpoint, name: account.name };
}
