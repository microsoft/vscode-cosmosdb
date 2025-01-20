/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { type DocumentDBDatabaseResourceItem } from '../../tree/docdb/DocumentDBDatabaseResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function createDocDBCollection(
    context: IActionContext,
    node?: DocumentDBDatabaseResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBDatabaseResourceItem>(context, {
            type: AzExtResourceType.AzureCosmosDb,
            expectedChildContextValue: 'treeItem.database',
        });
    }

    if (node instanceof DocumentDBDatabaseResourceItem) {
        // New Wizard
        // Put container name
        // Put partition key
    }
}
