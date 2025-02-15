/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { StoredProcedureFileDescriptor } from '../../docdb/fs/StoredProcedureFileDescriptor';
import { ext } from '../../extensionVariables';
import { type DocumentDBStoredProcedureResourceItem } from '../../tree/docdb/DocumentDBStoredProcedureResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function openDocumentDBStoredProcedure(
    context: IActionContext,
    node?: DocumentDBStoredProcedureResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBStoredProcedureResourceItem>(context, {
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
