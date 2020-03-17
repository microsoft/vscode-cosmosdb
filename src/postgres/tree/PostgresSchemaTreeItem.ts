/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schema, Table } from 'pg-structure';
import * as _ from 'underscore';
import * as vscode from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { PostgresTableTreeItem } from './PostgresTableTreeItem';

export class PostgresSchemaTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresSchema";
    public readonly contextValue: string = PostgresSchemaTreeItem.contextValue;
    public readonly childTypeLabel: string = "Table";
    public readonly schema: Schema;

    constructor(parent: AzureParentTreeItem, schema: Schema) {
        super(parent);
        this.schema = schema;
    }

    public get id(): string {
        return this.schema.name;
    }

    public get label(): string {
        return this.schema.name;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Collection.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<PostgresTableTreeItem[]> {
        const tables: Table[] = this.schema.tables;
        return tables.map(table => new PostgresTableTreeItem(this, table));
    }
}
