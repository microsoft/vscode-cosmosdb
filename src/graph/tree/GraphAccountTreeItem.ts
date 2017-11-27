/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseMeta } from 'documentdb';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { GraphDatabaseTreeItem } from './GraphDatabaseTreeItem';

export class GraphAccountTreeItem extends DocDBAccountTreeItemBase {
    public static contextValue: string = "cosmosDBGraphAccount";
    public contextValue: string = GraphAccountTreeItem.contextValue;

    public initChild(database: DatabaseMeta): IAzureTreeItem {
        return new GraphDatabaseTreeItem(this.documentEndpoint, this.masterKey, database, this.id);
    }
}
