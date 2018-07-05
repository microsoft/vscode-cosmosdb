/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import { GraphViewsManager } from '../GraphViewsManager';
import { GraphConfiguration } from '../GraphConfiguration';
import * as vscode from 'vscode';
import { CollectionMeta } from 'documentdb';
import { GraphDatabaseTreeItem } from './GraphDatabaseTreeItem';

export class GraphTreeItem implements IAzureTreeItem {
    public static contextValue: string = "cosmosDBGraphGraph";
    public readonly contextValue: string = GraphTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openGraphExplorer';

    private readonly _database: GraphDatabaseTreeItem;
    private readonly _collection: CollectionMeta;

    constructor(database: GraphDatabaseTreeItem, collection: CollectionMeta) {
        this._database = database;
        this._collection = collection;
    }

    public get id(): string {
        return this._collection.id;
    }

    public get label(): string {
        return "Graph";
    }

    public get link(): string {
        return this._collection._self;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'Collection.svg'),
        };
    }

    public async showExplorer(graphViewsManager: GraphViewsManager): Promise<void> {
        await graphViewsManager.showGraphViewer(this._collection.id, <GraphConfiguration>{
            documentEndpoint: this._database.documentEndpoint,
            gremlinEndpoint: this._database.gremlinEndpoint,
            possibleGremlinEndpoints: this._database.possibleGremlinEndpoints,
            databaseName: this._database.label,
            graphName: this._collection.id,
            key: this._database.masterKey
        });
    }
}
