/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { createNoSqlQueryConnection } from '../../cosmosdb/NoSqlQueryConnection';
import { DocumentTab } from '../../panels/DocumentTab';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBItemsResourceItem } from '../../tree/cosmosdb/CosmosDBItemsResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBCreateDocument(
    context: IActionContext,
    node?: CosmosDBContainerResourceItem | CosmosDBItemsResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.container'],
        });
    }

    if (!node) {
        return;
    }

    DocumentTab.render(createNoSqlQueryConnection(node), 'add', undefined, vscode.ViewColumn.Active);
}
