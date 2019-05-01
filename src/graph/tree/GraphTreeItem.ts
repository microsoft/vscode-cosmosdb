/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionMeta } from 'documentdb';
import * as path from 'path';
import * as vscode from 'vscode';
import { AzureTreeItem } from 'vscode-azureextensionui';
import { getResourcesPath } from '../../constants';
import { IDocDBTreeRoot } from '../../docdb/tree/IDocDBTreeRoot';
import { GraphConfiguration } from '../GraphConfiguration';
import { GraphViewsManager } from '../GraphViewsManager';
import { GraphCollectionTreeItem } from './GraphCollectionTreeItem';
import { GraphDatabaseTreeItem } from './GraphDatabaseTreeItem';

export class GraphTreeItem extends AzureTreeItem<IDocDBTreeRoot> {
    public static contextValue: string = "cosmosDBGraphGraph";
    public readonly contextValue: string = GraphTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openGraphExplorer';
    public readonly parent: GraphCollectionTreeItem;

    private readonly _collection: CollectionMeta;

    constructor(parent: GraphCollectionTreeItem, collection: CollectionMeta) {
        super(parent);
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
            light: path.join(getResourcesPath(), 'icons', 'theme-agnostic', 'Collection.svg'),
            dark: path.join(getResourcesPath(), 'icons', 'theme-agnostic', 'Collection.svg')
        };
    }

    public async showExplorer(graphViewsManager: GraphViewsManager): Promise<void> {
        const databaseTreeItem: GraphDatabaseTreeItem = this.parent.parent;
        await graphViewsManager.showGraphViewer(this._collection.id, <GraphConfiguration>{
            documentEndpoint: databaseTreeItem.root.documentEndpoint,
            gremlinEndpoint: databaseTreeItem.gremlinEndpoint,
            possibleGremlinEndpoints: databaseTreeItem.possibleGremlinEndpoints,
            databaseName: databaseTreeItem.label,
            graphName: this._collection.id,
            key: databaseTreeItem.root.masterKey
        });
    }
}
