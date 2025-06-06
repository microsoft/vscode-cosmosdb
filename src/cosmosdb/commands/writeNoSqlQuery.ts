/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import * as vscodeUtil from '../../utils/vscodeUtils';
import { setConnectedNoSqlContainer } from './connectNoSqlContainer';

export async function writeNoSqlQuery(context: IActionContext, node?: CosmosDBContainerResourceItem): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.container'],
        });
    }
    setConnectedNoSqlContainer(node);
    const sampleQuery = `SELECT * FROM ${node.model.container.id}`;
    await vscodeUtil.showNewFile(sampleQuery, `query for ${node.model.container.id}`, '.nosql');
}
