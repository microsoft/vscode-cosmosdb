/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseDefinition, Resource } from '@azure/cosmos';
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

    public initChild(resource: DatabaseDefinition & Resource): DocDBDatabaseTreeItem {
        this.valuesToMask.push(resource._rid, resource._self);
        return new DocDBDatabaseTreeItem(this, resource);
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
