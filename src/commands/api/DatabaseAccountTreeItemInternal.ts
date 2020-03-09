/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocDBAccountTreeItemBase } from '../../docdb/tree/DocDBAccountTreeItemBase';
import { API } from '../../experience';
import { ext } from '../../extensionVariables';
import { ParsedMongoConnectionString } from '../../mongo/mongoConnectionStrings';
import { MongoAccountTreeItem } from '../../mongo/tree/MongoAccountTreeItem';
import { ParsedConnectionString } from '../../ParsedConnectionString';
import { DatabaseAccountTreeItem } from '../../vscode-cosmosdb.api';

export class DatabaseAccountTreeItemInternal implements DatabaseAccountTreeItem {
    protected _parsedCS: ParsedConnectionString;
    private _accountNode: MongoAccountTreeItem | DocDBAccountTreeItemBase | undefined;

    constructor(parsedCS: ParsedConnectionString, accountNode?: MongoAccountTreeItem | DocDBAccountTreeItemBase) {
        this._parsedCS = parsedCS;
        this._accountNode = accountNode;
    }

    public get connectionString(): string {
        return this._parsedCS.connectionString;
    }

    public get hostName(): string {
        return this._parsedCS.hostName;
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

    public get docDBData(): { masterKey: string; documentEndpoint: string; } | undefined {
        if (this._accountNode instanceof DocDBAccountTreeItemBase) {
            return {
                documentEndpoint: this._accountNode.root.documentEndpoint,
                masterKey: this._accountNode.root.masterKey
            };
        } else {
            return undefined;
        }
    }

    public async reveal(): Promise<void> {
        ext.treeView.reveal(await this.getAccountNode());
    }

    protected async getAccountNode(): Promise<MongoAccountTreeItem | DocDBAccountTreeItemBase> {
        // If this._accountNode is undefined, attach a new node based on connection string
        if (!this._accountNode) {
            const apiType = this._parsedCS instanceof ParsedMongoConnectionString ? API.MongoDB : API.Core;
            this._accountNode = await ext.attachedAccountsNode.attachConnectionString(this.connectionString, apiType);
        }

        return this._accountNode;
    }
}
