/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocDBDatabaseTreeItem } from './DocDBDatabaseTreeItem';
import { DatabaseMeta } from 'documentdb';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import { DocDBAccountTreeItemBase } from './DocDBAccountTreeItemBase';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBDocumentTreeItem } from './DocDBDocumentTreeItem';
import { DocDBStoredProcedureTreeItem } from './DocDBStoredProcedureTreeItem';

export class DocDBAccountTreeItem extends DocDBAccountTreeItemBase {
    public static contextValue: string = "cosmosDBDocumentServer";
    public contextValue: string = DocDBAccountTreeItem.contextValue;

    public initChild(database: DatabaseMeta): IAzureTreeItem {
        return new DocDBDatabaseTreeItem(this.documentEndpoint, this.masterKey, database, this.isEmulator);
    }

    public isAncestorOf(contextValue: string): boolean {
        switch (contextValue) {
            case DocDBDatabaseTreeItem.contextValue:
            case DocDBCollectionTreeItem.contextValue:
            case DocDBDocumentTreeItem.contextValue:
            case DocDBStoredProcedureTreeItem.contextValue: //asdf
                return true;
            default:
                return false;
        }
    }
}
