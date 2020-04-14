/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, ClientConfig } from "pg";
import pgStructure, { Db, Table } from "pg-structure";
import { Uri } from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { PostgresDatabaseTreeItem } from "./PostgresDatabaseTreeItem";
import { PostgresTableTreeItem } from "./PostgresTableTreeItem";

export class PostgresTablesTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresTables";
    public readonly contextValue: string = PostgresTablesTreeItem.contextValue;
    public readonly childTypeLabel: string = "Table";
    public readonly label: string = 'Tables';
    public readonly tables: Table[];
    public readonly clientConfig: ClientConfig;

    constructor(parent: PostgresDatabaseTreeItem, clientConfig: ClientConfig) {
        super(parent);
        this.clientConfig = clientConfig;
    }

    public get iconPath(): string | Uri | { light: string | Uri; dark: string | Uri } {
        return getThemeAgnosticIconPath('Collection.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<PostgresTableTreeItem[]> {
        const client = new Client(this.clientConfig);
        const db: Db = await pgStructure(client);
        return db.tables.map(table => new PostgresTableTreeItem(this, table));
    }
}
