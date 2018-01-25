/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseMeta } from 'documentdb';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { GraphDatabaseTreeItem } from './GraphDatabaseTreeItem';
import { GraphCollectionTreeItem } from './GraphCollectionTreeItem';
import { IGremlinEndpoint } from '../gremlinEndpoints';

export class GraphAccountTreeItem extends DocDBAccountTreeItemBase {
    public static contextValue: string = "cosmosDBGraphAccount";
    public contextValue: string = GraphAccountTreeItem.contextValue;

    constructor(id: string, label: string, documentEndpoint: string, private _gremlinEndpoint: IGremlinEndpoint | undefined, masterKey: string, isEmulator: boolean) {
        super(id, label, documentEndpoint, masterKey, isEmulator);
    }

    public initChild(database: DatabaseMeta): IAzureTreeItem {
        return new GraphDatabaseTreeItem(this.documentEndpoint, this._gremlinEndpoint, this.masterKey, database, this.id, this.isEmulator);
    }

    public isAncestorOf(contextValue: string): boolean {
        switch (contextValue) {
            case GraphDatabaseTreeItem.contextValue:
            case GraphCollectionTreeItem.contextValue:
                return true;
            default:
                return false;
        }
    }
}
