/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { isNoSqlQueryConnection, type NoSqlQueryConnection } from '../../cosmosdb/NoSqlQueryConnection';
import { QueryEditorTab } from '../../panels/QueryEditorTab';
import { type CosmosDBContainerResourceItem } from '../../tree/cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBItemsResourceItem } from '../../tree/cosmosdb/CosmosDBItemsResourceItem';
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function openNoSqlQueryEditor(
    context: IActionContext,
    nodeOrConnection?: TreeElement | FabricTreeElement | NoSqlQueryConnection, //CosmosDBContainerResourceItem | CosmosDBItemsResourceItem,
): Promise<void> {
    let connection: NoSqlQueryConnection;

    if (isNoSqlQueryConnection(nodeOrConnection)) {
        // Input is already a connection
        connection = nodeOrConnection;
    } else {
        const element: TreeElement | undefined = isFabricTreeElement(nodeOrConnection)
            ? nodeOrConnection.element
            : isTreeElement(nodeOrConnection)
              ? nodeOrConnection
              : await pickAppResource<CosmosDBContainerResourceItem | CosmosDBItemsResourceItem>(context, {
                    type: AzExtResourceType.AzureCosmosDb,
                    expectedChildContextValue: ['treeItem.container'],
                });

        if (!element) {
            return undefined;
        }

        if (isTreeElementWithExperience(element)) {
            context.telemetry.properties.experience = element.experience.api;
        }

        if (
            !isTreeElementWithContextValue(element) ||
            (!element.contextValue.includes('treeItem.container') &&
                !element.contextValue.includes('treeItem.items') &&
                !element.contextValue.includes('treeItem.queryEditor'))
        ) {
            throw new Error(l10n.t('The selected item is not a Cosmos DB container.'));
        }

        const containerNode = element as CosmosDBContainerResourceItem;

        connection = {
            databaseId: containerNode.model.database.id,
            containerId: containerNode.model.container.id,
            endpoint: containerNode.model.accountInfo.endpoint,
            credentials: containerNode.model.accountInfo.credentials,
            isEmulator: containerNode.model.accountInfo.isEmulator,
        };
    }

    if (!connection) {
        throw new Error(l10n.t('Failed to determine connection information for the selected item.'));
    }

    QueryEditorTab.render(connection);
}
