/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocDBDatabaseTreeItem } from './DocDBDatabaseTreeItem';
import { DatabaseMeta } from 'documentdb';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import { DocDBAccountTreeItemBase } from './DocDBAccountTreeItemBase';

export class DocDBAccountTreeItem extends DocDBAccountTreeItemBase {
    public static contextValue: string = "cosmosDBDocumentServer";
    public contextValue: string = DocDBAccountTreeItem.contextValue;

    public initChild(database: DatabaseMeta): IAzureTreeItem {
        return new DocDBDatabaseTreeItem(this.documentEndpoint, this.masterKey, database, this.id);
    }
}
