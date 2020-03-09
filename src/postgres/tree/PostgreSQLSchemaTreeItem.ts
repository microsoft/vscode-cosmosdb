/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schema, Table } from 'pg-structure';
import * as _ from 'underscore';
import * as vscode from 'vscode';
import { AzureParentTreeItem } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { IPostgreSQLTreeRoot } from './IPostgreSQLTreeRoot';
import { IPostgresTable, PostgreSQLTableTreeItem } from './PostgreSQLTableTreeItem';

export class PostgreSQLSchemaTreeItem extends AzureParentTreeItem<IPostgreSQLTreeRoot> {
    public static contextValue: string = "PostgresSchema";
    public readonly contextValue: string = PostgreSQLSchemaTreeItem.contextValue;
    public readonly childTypeLabel: string = "Table";

    private schema: Schema;

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

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<PostgreSQLTableTreeItem[]> {
        const tables: Table[] = this.schema.tables;
        return tables.map(table => new PostgreSQLTableTreeItem(this, <IPostgresTable>{ _id: table.oid }));
    }
}
