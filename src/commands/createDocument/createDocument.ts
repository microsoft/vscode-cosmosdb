/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { AzExtResourceType } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { createNoSqlQueryConnection } from '../../docdb/utils/NoSqlQueryConnection';
import { DocumentTab } from '../../panels/DocumentTab';
import { type DocumentDBContainerResourceItem } from '../../tree/docdb/DocumentDBContainerResourceItem';
import { type DocumentDBItemsResourceItem } from '../../tree/docdb/DocumentDBItemsResourceItem';
import { type CollectionItem } from '../../tree/documentdb/CollectionItem';
import { pickAppResource } from '../../utils/pickItem/pickAppResource';

export async function createDocumentDBDocument(
    context: IActionContext,
    node?: DocumentDBContainerResourceItem | DocumentDBItemsResourceItem,
): Promise<void> {
    if (!node) {
        node = await pickAppResource<DocumentDBContainerResourceItem>(context, {
            type: [AzExtResourceType.AzureCosmosDb],
            expectedChildContextValue: ['treeItem.container'],
        });
    }

    if (!node) {
        return;
    }

    DocumentTab.render(createNoSqlQueryConnection(node), 'add', undefined, vscode.ViewColumn.Active);
}

export async function createMongoDocument(context: IActionContext, node?: CollectionItem): Promise<void> {
    context.telemetry.properties.experience = node?.mongoCluster.dbExperience.api;

    if (!node) {
        node = await pickAppResource<CollectionItem>(context, {
            type: [AzExtResourceType.MongoClusters],
            expectedChildContextValue: ['treeItem.collection'],
        });
    }

    if (!node) {
        return;
    }

    await vscode.commands.executeCommand('command.internal.mongoClusters.documentView.open', {
        clusterId: node.mongoCluster.id,
        databaseName: node.databaseInfo.name,
        collectionName: node.collectionInfo.name,
        mode: 'add',
    });
}
