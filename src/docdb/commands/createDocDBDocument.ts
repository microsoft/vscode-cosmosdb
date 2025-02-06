/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import { ViewColumn } from 'vscode';
import { DocumentTab } from '../../panels/DocumentTab';
import { type DocumentDBContainerResourceItem } from '../../tree/docdb/DocumentDBContainerResourceItem';
import { type DocumentDBItemsResourceItem } from '../../tree/docdb/DocumentDBItemsResourceItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';
import { createNoSqlQueryConnection } from './connectNoSqlContainer';

export async function createDocDBDocument(
    context: IActionContext,
    node?: DocumentDBContainerResourceItem | DocumentDBItemsResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.container'],
        });
    }

    const connection = node ? createNoSqlQueryConnection(node) : undefined;

    if (!connection) {
        return;
    }

    DocumentTab.render(connection, 'add', undefined, ViewColumn.Active);
}
