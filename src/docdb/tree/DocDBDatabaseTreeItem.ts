/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionMeta } from 'documentdb';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBDatabaseTreeItemBase } from './DocDBDatabaseTreeItemBase';

export class DocDBDatabaseTreeItem extends DocDBDatabaseTreeItemBase {
    public static contextValue: string = "cosmosDBDocumentDatabase";
    public readonly contextValue: string = DocDBDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Collection';

    public initChild(collection: CollectionMeta): DocDBCollectionTreeItem {
        return new DocDBCollectionTreeItem(this, collection);
    }
}
