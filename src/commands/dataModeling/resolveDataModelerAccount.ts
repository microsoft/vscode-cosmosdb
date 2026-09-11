/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { getControlPlane } from '../../cosmosdb/controlPlane';
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
    let account: DataModelerAccount;
    if ('endpoint' in source) {
        account = source;
    } else {
        const accountInfo = await getAccountInfo(source.account);
        account = {
            endpoint: accountInfo.endpoint,
            name: accountInfo.name,
            getControlPlane: () => getControlPlane(accountInfo),
            getDeploymentTarget: () => accountInfo.azureMetadata,
        };
    }
    if (account.endpoint.trim()) {
        context.valuesToMask.push(account.endpoint);
    }
    if (account.name?.trim()) {
        context.valuesToMask.push(account.name);
    }
    return account;
}
