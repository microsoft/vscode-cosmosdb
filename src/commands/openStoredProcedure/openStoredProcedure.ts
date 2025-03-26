/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { StoredProcedureFileDescriptor } from '../../cosmosdb/fs/StoredProcedureFileDescriptor';
import { ext } from '../../extensionVariables';
import { type CosmosDBStoredProcedureResourceItem } from '../../tree/cosmosdb/CosmosDBStoredProcedureResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function cosmosDBOpenStoredProcedure(
    context: IActionContext,
    node?: CosmosDBStoredProcedureResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<CosmosDBStoredProcedureResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.storedProcedure'],
        });
    }

    if (!node) {
        return;
    }

    context.telemetry.properties.experience = node.experience.api;

    const fsNode = new StoredProcedureFileDescriptor(node.id, node.model, node.experience);
    await ext.fileSystem.showTextDocument(fsNode);
}
