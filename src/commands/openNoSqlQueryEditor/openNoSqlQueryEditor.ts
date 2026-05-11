/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { API } from '../../AzureDBExperiences';
import { createNoSqlQueryConnection, type NoSqlQueryConnection } from '../../cosmosdb/NoSqlQueryConnection';
import { QueryEditorTab } from '../../panels/QueryEditorTab';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBItemsResourceItem } from '../../tree/cosmosdb/CosmosDBItemsResourceItem';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function openNoSqlQueryEditor(
    context: IActionContext,
    nodeOrConnection?: CosmosDBContainerResourceItem | CosmosDBItemsResourceItem | NoSqlQueryConnection,
): Promise<void> {
    let connection: NoSqlQueryConnection;

    if (!nodeOrConnection) {
        // Case 1: No input provided, prompt user to select a container
        const node = await pickAppResource<CosmosDBContainerResourceItem | CosmosDBItemsResourceItem>(context, {
            type: AzExtResourceType.AzureCosmosDb,
            expectedChildContextValue: ['treeItem.container', 'treeItem.items'],
        });

        if (!node) {
            return;
        }

        context.telemetry.properties.experience = node.experience.api;
        connection = createNoSqlQueryConnection(node);
    } else if (isTreeElementWithExperience(nodeOrConnection)) {
        // Case 2: Input is a container node (using proper type guard)
        context.telemetry.properties.experience = nodeOrConnection.experience.api;
        connection = createNoSqlQueryConnection(nodeOrConnection);
    } else {
        // Case 3: Input is already a connection
        context.telemetry.properties.experience = API.Core;
        connection = nodeOrConnection;
    }

    QueryEditorTab.render(connection);
}
