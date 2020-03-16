/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionMeta, DatabaseMeta } from 'documentdb';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { IGremlinEndpoint } from '../../vscode-cosmosdbgraph.api';
import { getPossibleGremlinEndpoints } from '../gremlinEndpoints';
import { GraphAccountTreeItem } from './GraphAccountTreeItem';
import { GraphCollectionTreeItem } from './GraphCollectionTreeItem';

export class GraphDatabaseTreeItem extends DocDBDatabaseTreeItemBase {
    public static contextValue: string = "cosmosDBGraphDatabase";
    public readonly contextValue: string = GraphDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Graph';

    constructor(parent: GraphAccountTreeItem, private _gremlinEndpoint: IGremlinEndpoint | undefined, database: DatabaseMeta) {
        super(parent, database);
    }

    public initChild(collection: CollectionMeta): GraphCollectionTreeItem {
        return new GraphCollectionTreeItem(this, collection);
    }

    // Gremlin endpoint, if definitely known
    get gremlinEndpoint(): IGremlinEndpoint | undefined {
        return this._gremlinEndpoint;
    }

    get possibleGremlinEndpoints(): IGremlinEndpoint[] {
        return getPossibleGremlinEndpoints(this.root.documentEndpoint);
    }
}
