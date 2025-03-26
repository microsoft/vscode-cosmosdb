/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { getCosmosAuthCredential, getCosmosKeyCredential } from '../../cosmosdb/getCosmosClient';
import { type NoSqlQueryConnection } from '../../cosmosdb/NoSqlCodeLensProvider';
import { QueryEditorTab } from '../../panels/QueryEditorTab';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBItemsResourceItem } from '../../tree/cosmosdb/CosmosDBItemsResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function openNoSqlQueryEditor(
    context: IActionContext,
    node?: CosmosDBContainerResourceItem | CosmosDBItemsResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBContainerResourceItem | CosmosDBItemsResourceItem>(context, {
            type: AzExtResourceType.AzureCosmosDb,
            expectedChildContextValue: ['treeItem.container', 'treeItem.items'],
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const accountInfo = node.model.accountInfo;
    const keyCred = getCosmosKeyCredential(accountInfo.credentials);
    const tenantId = getCosmosAuthCredential(accountInfo.credentials)?.tenantId;
    const connection: NoSqlQueryConnection = {
        databaseId: node.model.database.id,
        containerId: node.model.container.id,
        endpoint: accountInfo.endpoint,
        masterKey: keyCred?.key,
        isEmulator: accountInfo.isEmulator,
        tenantId: tenantId,
    };

    QueryEditorTab.render(connection);
}
