/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { ParsedMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { DatabaseTreeItem } from '../../vscode-cosmosdb.api';
import { DatabaseAccountTreeItemInternal } from './DatabaseAccountTreeItemInternal';

export class DatabaseTreeItemInternal extends DatabaseAccountTreeItemInternal implements DatabaseTreeItem {
    private _dbNode: AzureTreeItem | undefined;

    constructor(parsedCS: ParsedMongoConnectionString & { databaseName: string }, accountNode?: MongoAccountTreeItem, dbNode?: MongoDatabaseTreeItem) {
        super(parsedCS, accountNode);
        this._dbNode = dbNode;
    }

    public get databaseName(): string {
        return this._parsedCS.databaseName;
    }

    public async reveal(): Promise<void> {
        const accountNode: MongoAccountTreeItem = await this.getAccountNode();
        if (!this._dbNode) {
            const databaseId = `${accountNode.fullId}/${this.databaseName}`;
            this._dbNode = await ext.tree.findTreeItem(databaseId);
        }

        ext.treeView.reveal(this._dbNode || accountNode);
    }
}
