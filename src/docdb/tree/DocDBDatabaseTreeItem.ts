/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContainerDefinition, CosmosClient, Database, Resource } from '@azure/cosmos';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBDatabaseTreeItemBase } from './DocDBDatabaseTreeItemBase';

export class DocDBDatabaseTreeItem extends DocDBDatabaseTreeItemBase {
    public static contextValue: string = "cosmosDBDocumentDatabase";
    public readonly contextValue: string = DocDBDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Collection';

    public initChild(container: ContainerDefinition & Resource): DocDBCollectionTreeItem {
        return new DocDBCollectionTreeItem(this, container);
    }

    public getDatabaseClient(client: CosmosClient): Database {
        return client.database(this.id);
    }
}
