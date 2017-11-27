/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { IAzureTreeItem, IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { GraphViewsManager } from '../GraphViewsManager';
import { GraphConfiguration } from '../GraphConfiguration';
import { DialogBoxResponses } from '../../constants';
import * as vscode from 'vscode';
import { CollectionMeta } from 'documentdb';
import { GraphDatabaseTreeItem } from './GraphDatabaseTreeItem'

export class GraphCollectionTreeItem implements IAzureTreeItem {
    public static contextValue: string = "cosmosDBGraph";
    public readonly contextValue: string = GraphCollectionTreeItem.contextValue;
    public readonly commandId: string = 'graph.openExplorer';

    private readonly _database: GraphDatabaseTreeItem;
    private readonly _collection: CollectionMeta;
    private readonly _parentId: string;

    constructor(database: GraphDatabaseTreeItem, collection: CollectionMeta, parentId: string) {
        this._database = database;
        this._collection = collection;
        this._parentId = parentId;
    }

    public get id(): string {
        return `${this._parentId}/${this._collection.id}`;
    }

    public get label(): string {
        return this._collection.id;
    }

    public get link(): string {
        return this._collection._self;
    }

    get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
        };
    }

    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete graph '${this.label}' and its contents?`;
        const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.No);
        if (result === DialogBoxResponses.Yes) {
            const client = this._database.getDocumentClient();
            await new Promise((resolve, reject) => {
                client.deleteCollection(this.link, function (err) {
                    err ? reject(new Error(err.body)) : resolve();
                });
            });
        } else {
            throw new UserCancelledError();
        }
    }

    public async showExplorer(graphViewsManager: GraphViewsManager): Promise<void> {
        await graphViewsManager.showGraphViewer(this.id, <GraphConfiguration>{
            endpoint: this._database.graphEndpoint,
            endpointPort: this._database.graphPort,
            databaseName: this._database.id,
            graphName: this.id,
            key: this._database.masterKey
        });
    }
}
