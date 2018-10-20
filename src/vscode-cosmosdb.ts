import { DocDBDatabaseTreeItem } from "./docdb/tree/DocDBDatabaseTreeItem";
import { ext } from "./extensionVariables";
import { MongoDatabaseTreeItem } from "./mongo/tree/MongoDatabaseTreeItem";
import { VscodeCosmos } from "./vscode-cosmosdb.api";

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class CosmosAPI {
    api: VscodeCosmos = {
        getConnectionString: (treeItemId: string) => this.getConnectionString(treeItemId),
        getDatabase: () => this.getDatabase(),
        revealTreeItem: (treeItemId: string) => this.revealTreeItem(treeItemId)
    };

    async getConnectionString(treeItemId: string): Promise<string> {
        const node = await ext.tree.findTreeItem(treeItemId);
        if (!node) {
            throw new Error(`Couldn't find the database node in Cosmos DB with provided Id: ${treeItemId}`);
        }

        if (node instanceof MongoDatabaseTreeItem) {
            return node.connectionString;
        } else {
            throw new Error('Not implemented yet. For now works only with Mongo.');
        }
    }

    async getDatabase(): Promise<string> {
        return (await ext.tree.showTreeItemPicker([MongoDatabaseTreeItem.contextValue, DocDBDatabaseTreeItem.contextValue])).fullId;
    }

    async revealTreeItem(treeItemId: string): Promise<void> {
        const node = await ext.tree.findTreeItem(treeItemId);
        if (!node) {
            throw new Error(`Couldn't find the database node in Cosmos DB with provided Id: ${treeItemId}`);
        }
        ext.treeView.reveal(node);
    }
}
