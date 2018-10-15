/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseMeta } from 'documentdb';
import { DocDBAccountTreeItemBase } from './DocDBAccountTreeItemBase';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBDatabaseTreeItem } from './DocDBDatabaseTreeItem';
import { DocDBDocumentsTreeItem } from './DocDBDocumentsTreeItem';
import { DocDBDocumentTreeItem } from './DocDBDocumentTreeItem';
import { DocDBStoredProceduresTreeItem } from './DocDBStoredProceduresTreeItem';
import { DocDBStoredProcedureTreeItem } from './DocDBStoredProcedureTreeItem';

export class DocDBAccountTreeItem extends DocDBAccountTreeItemBase {
    public static contextValue: string = "cosmosDBDocumentServer";
    public contextValue: string = DocDBAccountTreeItem.contextValue;

    public initChild(database: DatabaseMeta): DocDBDatabaseTreeItem {
        return new DocDBDatabaseTreeItem(this, database);
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            case DocDBDatabaseTreeItem.contextValue:
            case DocDBCollectionTreeItem.contextValue:
            case DocDBDocumentTreeItem.contextValue:
            case DocDBStoredProcedureTreeItem.contextValue:
            case DocDBDocumentsTreeItem.contextValue:
            case DocDBStoredProceduresTreeItem.contextValue:
                return true;
            default:
                return false;
        }
    }
}
