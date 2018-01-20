/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureTreeItem } from 'vscode-azureextensionui';
import { CollectionMeta, DatabaseMeta } from 'documentdb';
import CosmosDBManagementClient = require("azure-arm-cosmosdb");
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { GraphCollectionTreeItem } from './GraphCollectionTreeItem';
import { IGremlinEndpoint } from '../GremlinEndpoint';

export class GraphDatabaseTreeItem extends DocDBDatabaseTreeItemBase {
    public static contextValue: string = "cosmosDBGraphDatabase";
    public readonly contextValue: string = GraphDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Graph';

    private _graphPort: number;

    constructor(documentEndpoint: string, private _gremlinEndpoint: IGremlinEndpoint, masterKey: string, database: DatabaseMeta, parentId: string) {
        super(documentEndpoint, masterKey, database, parentId);
    }

    public initChild(collection: CollectionMeta): IAzureTreeItem {
        return new GraphCollectionTreeItem(this, collection, this.id);
    }

    public get gremlinEndpoint(): IGremlinEndpoint {
        return this._gremlinEndpoint;
    }
}
