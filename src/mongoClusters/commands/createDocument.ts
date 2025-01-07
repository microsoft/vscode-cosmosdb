/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext } from '@microsoft/vscode-azext-utils';
import { type CollectionItem } from '../tree/CollectionItem';

import * as vscode from 'vscode';


export async function createDocument(context: IActionContext, node?: CollectionItem): Promise<void> {
    context.telemetry.properties.experience = node?.mongoCluster.dbExperience?.api;

    // node ??= ... pick a node if not provided
    if (!node) {
        throw new Error('No collection selected.');
    }

    await vscode.commands.executeCommand('command.internal.mongoClusters.documentView.open', {
        clusterId: node.mongoCluster.id,
        databaseName: node.databaseInfo.name,
        collectionName: node.collectionInfo.name,
        mode: 'add',
    });
}
