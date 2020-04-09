/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from 'pg';
import { Schema } from 'pg-structure';
import * as vscode from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';

export class PostgresSchemaTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresSchema";
    public readonly contextValue: string = PostgresSchemaTreeItem.contextValue;
    public readonly schema: Schema;
    public readonly clientConfig: ClientConfig;
    public readonly parent: PostgresDatabaseTreeItem;
    public autoSelectInTreeItemPicker: boolean = true;

    private _functionsTreeItem: PostgresFunctionsTreeItem;
    private _tablesTreeItem: PostgresTablesTreeItem;

    constructor(parent: PostgresDatabaseTreeItem, schema: Schema, clientConfig: ClientConfig) {
        super(parent);
        this.schema = schema;
        this.clientConfig = clientConfig;
        this._functionsTreeItem = new PostgresFunctionsTreeItem(this);
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

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<(PostgresFunctionsTreeItem | PostgresTablesTreeItem)[]> {
        return [this._functionsTreeItem, this._tablesTreeItem];
    }
}
