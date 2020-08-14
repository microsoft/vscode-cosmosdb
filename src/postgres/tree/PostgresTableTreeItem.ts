/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Table } from 'pg-structure';
import * as vscode from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemedIconPath } from '../../constants';
import { runPostgresQuery } from '../runPostgresQuery';
import { PostgresColumnTreeItem } from './PostgresColumnTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';

export class PostgresTableTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresTable";
    public readonly contextValue: string = PostgresTableTreeItem.contextValue;
    public readonly table: Table;
    public readonly parent: PostgresTablesTreeItem;

    private _isDuplicate: boolean;

    constructor(parent: PostgresTablesTreeItem, table: Table, isDuplicate: boolean) {
        super(parent);
        this.table = table;
        this._isDuplicate = isDuplicate;
    }

    public get id(): string {
        return String(this.table.oid);
    }

    public get label(): string {
        return this.table.name;
    }

    public get description(): string | undefined {
        return this._isDuplicate ? this.table.schema.name : undefined;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemedIconPath('window.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<PostgresColumnTreeItem[]> {

        return this.table.columns.map(column => new PostgresColumnTreeItem(this, column.name));
    }

    public async deleteTreeItemImpl(): Promise<void> {
        await runPostgresQuery(this.parent.clientConfig, `Drop Table ${this.table.schema.name}."${this.label}";`);
    }

}
