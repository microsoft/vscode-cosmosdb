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
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBCreateDocument(
    context: IActionContext,
    node?: TreeElement | FabricTreeElement,
): Promise<void> {
    const element: TreeElement | undefined = isFabricTreeElement(node)
        ? node?.element
        : isTreeElement(node)
          ? node
          : await pickAppResource<CosmosDBContainerResourceItem>(context, {
                type: [AzExtResourceType.AzureCosmosDb],
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
        !(element.contextValue.includes('treeItem.container') && element.contextValue.includes('treeItem.items'))
    ) {
        return undefined;
    }

    const containerNode = element as CosmosDBContainerResourceItem;

    DocumentTab.render(createNoSqlQueryConnection(containerNode), 'add', undefined, vscode.ViewColumn.Active);
}
