/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { TriggerFileDescriptor } from '../../docdb/fs/TriggerFileDescriptor';
import { ext } from '../../extensionVariables';
import { type DocumentDBTriggerResourceItem } from '../../tree/docdb/DocumentDBTriggerResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function openDocumentDBTrigger(
    context: IActionContext,
    node?: DocumentDBTriggerResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBTriggerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.trigger'],
        });
    }

    if (!node) {
        return undefined;
    }

    context.telemetry.properties.experience = node.experience.api;

    const fsNode = new TriggerFileDescriptor(node.id, node.model, node.experience);
    await ext.fileSystem.showTextDocument(fsNode);
}
