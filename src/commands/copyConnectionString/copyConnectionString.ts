/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { isTreeElement, type TreeElement } from '../../tree/TreeElement';
import { isTreeElementWithContextValue } from '../../tree/TreeElementWithContextValue';
import { isTreeElementWithExperience } from '../../tree/TreeElementWithExperience';
import { type CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { isFabricTreeElement, type FabricTreeElement } from '../../tree/fabric-resources-view/FabricTreeElement';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function copyConnectionString(
    context: IActionContext,
    node?: TreeElement | FabricTreeElement,
): Promise<void> {
    const element: TreeElement | undefined = isFabricTreeElement(node)
        ? node.element
        : isTreeElement(node)
          ? node
          : // pickAppResource works only with Azure Resources tree
            await pickAppResource<CosmosDBAccountResourceItemBase>(context, {
                type: [AzExtResourceType.AzureCosmosDb],
            });

    if (!element) {
        return undefined;
    }

    const connectionString = await ext.state.runWithTemporaryDescription(element.id, l10n.t('Working…'), async () => {
        if (isTreeElementWithExperience(element)) {
            context.telemetry.properties.experience = element.experience.api;
        }

        if (isTreeElementWithContextValue(element) && element.contextValue.includes('treeItem.account')) {
            return (element as CosmosDBAccountResourceItemBase).getConnectionString();
        }

        return undefined;
    });

    if (!connectionString) {
        void vscode.window.showErrorMessage(
            l10n.t('Failed to extract the connection string from the selected account.'),
        );
    } else {
        await vscode.env.clipboard.writeText(connectionString);
        void vscode.window.showInformationMessage(l10n.t('The connection string has been copied to the clipboard'));
    }
}
