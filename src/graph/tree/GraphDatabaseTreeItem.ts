/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionMeta, DatabaseMeta } from 'documentdb';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { getPossibleGremlinEndpoints, IGremlinEndpoint } from '../gremlinEndpoints';
import { GraphCollectionTreeItem } from './GraphCollectionTreeItem';

export class GraphDatabaseTreeItem extends DocDBDatabaseTreeItemBase {
    public static contextValue: string = "cosmosDBGraphDatabase";
    public readonly contextValue: string = GraphDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Graph';

    constructor(documentEndpoint: string, private _gremlinEndpoint: IGremlinEndpoint | undefined, masterKey: string, database: DatabaseMeta, isEmulator: boolean) {
        super(documentEndpoint, masterKey, database, isEmulator);
    }

    public initChild(collection: CollectionMeta): IAzureTreeItem {
        return new GraphCollectionTreeItem(this, collection, this.documentEndpoint, this.masterKey, this.isEmulator);
    }

    // Gremlin endpoint, if definitely known
    get gremlinEndpoint(): IGremlinEndpoint | undefined {
        return this._gremlinEndpoint;
    }

    get possibleGremlinEndpoints(): IGremlinEndpoint[] {
        return getPossibleGremlinEndpoints(this.documentEndpoint);
    }
}
