/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schema } from 'pg-structure';
import * as vscode from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';

export class PostgresSchemaTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresSchema";
    public readonly contextValue: string = PostgresSchemaTreeItem.contextValue;
    public readonly schema: Schema;

    private _tablesTreeItem: PostgresTablesTreeItem;

    constructor(parent: AzureParentTreeItem, schema: Schema) {
        super(parent);
        this.schema = schema;
        this._tablesTreeItem = new PostgresTablesTreeItem(this);
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

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<PostgresTablesTreeItem[]> {
        return [this._tablesTreeItem];
    }
}
