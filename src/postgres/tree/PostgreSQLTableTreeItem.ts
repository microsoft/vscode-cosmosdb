/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Table } from 'pg-structure';
import * as vscode from 'vscode';
import { AzureTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { PostgreSQLSchemaTreeItem } from './PostgreSQLSchemaTreeItem';

export class PostgreSQLTableTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresTable";
    public readonly contextValue: string = PostgreSQLTableTreeItem.contextValue;
    public readonly table: Table;
    public readonly parent: PostgreSQLSchemaTreeItem;

    constructor(parent: PostgreSQLSchemaTreeItem, table: Table) {
        super(parent);
        this.table = table;
    }

    public get id(): string {
        return String(this.table.oid);
    }

    public get label(): string {
        return this.table.name;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Document.svg');
    }

}
