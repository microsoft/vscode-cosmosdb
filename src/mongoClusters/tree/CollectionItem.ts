/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    createGenericElement,
    nonNullValue,
    type IActionContext,
    type TreeElementBase,
} from '@microsoft/vscode-azext-utils';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import { type Document } from 'bson';
import type * as vscode from 'vscode';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { ext } from '../../extensionVariables';
import { appendToFile } from '../../utils/fs/appendToFile';
import { MongoClustersClient, type CollectionItemModel, type DatabaseItemModel, type InsertDocumentsResult } from '../MongoClustersClient';
import { IndexesItem } from './IndexesItem';
import { type MongoClusterItemBase, type MongoClusterModel } from './MongoClusterItem';


export class CollectionItem implements MongoClusterItemBase {
    id: string;

    constructor(
        readonly subscription: AzureSubscription,
        readonly mongoCluster: MongoClusterModel,
        readonly databaseInfo: DatabaseItemModel,
        readonly collectionInfo: CollectionItemModel,
    ) {
        this.id = `${mongoCluster.id}/${databaseInfo.name}/${collectionInfo.name}`;
    }

    async getChildren(): Promise<TreeElementBase[]> {
        return [
            createGenericElement({
                contextValue: 'mongoClusters.item.documents',
                id: `${this.id}/documents`,
                label: 'Documents',
                commandId: 'mongoClusters.internal.containerView.open',
                commandArgs: [
                    {
                        id: this.id,
                        viewTitle: `${this.collectionInfo.name}`,
                        // viewTitle: `${this.mongoCluster.name}/${this.databaseInfo.name}/${this.collectionInfo.name}`, // using '/' as a separator to use VSCode's "title compression"(?) feature

                        liveConnectionId: this.mongoCluster.session?.credentialId,
                        databaseName: this.databaseInfo.name,
                        collectionName: this.collectionInfo.name,
                    },
                ],
                iconPath: new ThemeIcon('explorer-view-icon'),
            }),
            new IndexesItem(this.subscription, this.mongoCluster, this.databaseInfo, this.collectionInfo),
        ];
    }

    async delete(_context: IActionContext): Promise<boolean> {
        const client = await MongoClustersClient.getClient(nonNullValue(this.mongoCluster.session?.credentialId));

        await ext.state.showDeleting(this.id, async () => {
            await client.dropCollection(this.databaseInfo.name, this.collectionInfo.name);
        });

        ext.state.notifyChildrenChanged(`${this.mongoCluster.id}/${this.databaseInfo.name}`);

        return true;
    }

    async insertDocuments(_context: IActionContext, documents: Document[]): Promise<InsertDocumentsResult> {
        const client = await MongoClustersClient.getClient(nonNullValue(this.mongoCluster.session?.credentialId));

        let result: InsertDocumentsResult = { acknowledged: false, insertedCount: 0 };

        await ext.state.runWithTemporaryDescription(this.id, 'Importing...', async () => {
            result = await client.insertDocuments(this.databaseInfo.name, this.collectionInfo.name, documents);
        });

        return result;
    }

    async exportDocuments(_context: IActionContext, targetUri: vscode.Uri): Promise<void> {
        const client = await MongoClustersClient.getClient(nonNullValue(this.mongoCluster.session?.credentialId));

        const abortController = new AbortController();

        const docsStream = client.streamDocuments(this.databaseInfo.name, this.collectionInfo.name, abortController.signal);

        const filePath = targetUri.fsPath; // Convert `vscode.Uri` to a regular file path
        ext.outputChannel.appendLog(`MongoDB (vCore): Initializing data export to: ${filePath}`);

        let documentCount = 0;

        try {
            const bufferLimit = 4 * 1024 * 1024; // ~4 MB buffer limit
            let buffer = '';

            await appendToFile(filePath, '[\n'); // Start the JSON array

            for await (const doc of docsStream) {
                documentCount = documentCount + 1;
                const docString = JSON.stringify(doc, null, 4);

                buffer += buffer.length > 2 ? ',\n' : ''; // Add a comma and a newline if this isn't the first document
                buffer += docString;

                if (docString.length > bufferLimit) {
                    await appendToFile(filePath, buffer);
                    buffer = '';
                }
            }

            // just in case, the last buffer is not empty
            if (buffer.length > 0) {
                await appendToFile(filePath, buffer);
                buffer = '';
            }

            await appendToFile(filePath, '\n]'); // End the JSON array
        } catch (error) {
            ext.outputChannel.appendLog(`MongoDB (vCore): Error exporting documents: ${error}`);
        } finally {
            ext.outputChannel.appendLog(`MongoDB (vCore): Exported documents count: ${documentCount}`);
            abortController.abort();
        }
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: 'mongoClusters.item.collection',
            label: this.collectionInfo.name,
            iconPath: new ThemeIcon('folder-opened'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
