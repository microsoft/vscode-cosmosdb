/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { type CosmosDBAccountResourceItemBase } from '../../tree/azure-resources-view/cosmosdb/CosmosDBAccountResourceItemBase';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function copyConnectionString(
    context: IActionContext,
    node?: CosmosDBAccountResourceItemBase,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBAccountResourceItemBase>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
        });
    }

    if (!node) {
        return undefined;
    }

    const connectionString = await ext.state.runWithTemporaryDescription(node.id, l10n.t('Working…'), async () => {
        context.telemetry.properties.experience = node.experience.api;

        return node.getConnectionString();
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
