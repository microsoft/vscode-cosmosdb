/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAzureTreeItem } from 'vscode-azureextensionui';
import { CollectionMeta, DatabaseMeta } from 'documentdb';
import { DocDBDatabaseTreeItemBase } from '../../docdb/tree/DocDBDatabaseTreeItemBase';
import { GraphCollectionTreeItem } from './GraphCollectionTreeItem';

export class GraphDatabaseTreeItem extends DocDBDatabaseTreeItemBase {
    public static contextValue: string = "cosmosDBGraphDatabase";
    public readonly contextValue: string = GraphDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Graph';

    private _graphEndpoint: string;
    private _graphPort: number;

    constructor(documentEndpoint: string, masterKey: string, database: DatabaseMeta, parentId: string) {
        super(documentEndpoint, masterKey, database, parentId);
        this._parseEndpoint(documentEndpoint);
    }

    public initChild(collection: CollectionMeta): IAzureTreeItem {
        return new GraphCollectionTreeItem(this, collection, this.id);
    }

    private _parseEndpoint(documentEndpoint: string): void {
        // Document endpoint: https://<graphname>.documents.azure.com:443/
        // Gremlin endpoint: <graphname>.graphs.azure.com
        let [, address, , port] = documentEndpoint.match(/^[^:]+:\/\/([^:]+)(:([0-9]+))?\/?$/);
        this._graphEndpoint = address.replace(".documents.azure.com", ".graphs.azure.com");
        console.assert(this._graphEndpoint.match(/\.graphs\.azure\.com$/), "Unexpected endpoint format");
        this._graphPort = parseInt(port || "443");
        console.assert(this._graphPort > 0, "Unexpected port");
    }

    get graphEndpoint(): string {
        return this._graphEndpoint;
    }

    get graphPort(): number {
        return this._graphPort;
    }
}
