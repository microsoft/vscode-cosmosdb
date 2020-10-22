/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DatabaseAccountGetResults } from '@azure/arm-cosmosdb/src/models';
import { DatabaseMeta } from 'documentdb';
import { AzureParentTreeItem } from 'vscode-azureextensionui';
import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { DocDBStoredProceduresTreeItem } from '../../docdb/tree/DocDBStoredProceduresTreeItem';
import { DocDBStoredProcedureTreeItem } from '../../docdb/tree/DocDBStoredProcedureTreeItem';
import { IGremlinEndpoint } from '../../vscode-cosmosdbgraph.api';
import { GraphCollectionTreeItem } from './GraphCollectionTreeItem';
import { GraphDatabaseTreeItem } from './GraphDatabaseTreeItem';
import { GraphTreeItem } from './GraphTreeItem';

export class GraphAccountTreeItem extends DocDBAccountTreeItemBase {
    public static contextValue: string = "cosmosDBGraphAccount";
    public contextValue: string = GraphAccountTreeItem.contextValue;

    constructor(parent: AzureParentTreeItem, id: string, label: string, documentEndpoint: string, private _gremlinEndpoint: IGremlinEndpoint | undefined, masterKey: string, isEmulator: boolean | undefined, readonly databaseAccount?: DatabaseAccountGetResults) {
        super(parent, id, label, documentEndpoint, masterKey, isEmulator, databaseAccount);
    }

    public initChild(database: DatabaseMeta): GraphDatabaseTreeItem {
        return new GraphDatabaseTreeItem(this, this._gremlinEndpoint, database);
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            case GraphDatabaseTreeItem.contextValue:
            case GraphCollectionTreeItem.contextValue:
            case DocDBStoredProceduresTreeItem.contextValue:
            case DocDBStoredProcedureTreeItem.contextValue:
            case GraphTreeItem.contextValue:
                return true;
            default:
                return false;
        }
    }
}
