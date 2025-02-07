/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { ext } from '../../extensionVariables';
import { type DocumentDBItemResourceItem } from '../../tree/docdb/DocumentDBItemResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function openDocumentDBItem(context: IActionContext, node?: DocumentDBItemResourceItem): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBItemResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.document'],
        });
    }
    // Clear un-uploaded local changes to the document before opening https://github.com/microsoft/vscode-cosmosdb/issues/1619
    ext.fileSystem.fireChangedEvent(node);
    await ext.fileSystem.showTextDocument(node);
}
