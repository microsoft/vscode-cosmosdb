/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem } from 'vscode-azureextensionui';
import { ext } from '../../extensionVariables';
import { ParsedMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { MongoDatabaseTreeItem } from '../../mongo/tree/MongoDatabaseTreeItem';
import { DatabaseAccountTreeItem, DatabaseTreeItem } from '../../vscode-cosmosdb.api';

export class DatabaseAccountTreeItemInternal implements DatabaseAccountTreeItem {
    protected _parsedCS: ParsedMongoConnectionString;
    private _accountNode: MongoAccountTreeItem | undefined;

    constructor(parsedCS: ParsedMongoConnectionString, accountNode?: MongoAccountTreeItem) {
        this._parsedCS = parsedCS;
        this._accountNode = accountNode;
    }

    public get connectionString(): string {
        return this._parsedCS.connectionString;
    }

    public get hostName(): string {
        return this._parsedCS.host;
    }

    public get port(): string {
        return this._parsedCS.port;
    }

    public get azureData(): { accountName: string; } | undefined {
        if (this._accountNode && this._accountNode.databaseAccount) {
            return {
                accountName: this._accountNode.databaseAccount.name
            };
        } else {
            return undefined;
        }
    }

    public async reveal(): Promise<void> {
        ext.treeView.reveal(await this.getAccountNode());
    }

    protected async getAccountNode(): Promise<MongoAccountTreeItem> {
        // If this._accountNode is undefined, attach a new node based on connection string
        if (!this._accountNode) {
            this._accountNode = await ext.attachedAccountsNode.attachMongoConnectionString(this.connectionString);
        }

        return this._accountNode;
    }
}

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
