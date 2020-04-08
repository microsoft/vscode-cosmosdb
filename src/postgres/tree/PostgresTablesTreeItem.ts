/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Table } from "pg-structure";
import { Uri } from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { PostgresSchemaTreeItem } from "./PostgresSchemaTreeItem";
import { PostgresTableTreeItem } from "./PostgresTableTreeItem";

export class PostgresTablesTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresTables";
    public readonly contextValue: string = PostgresTablesTreeItem.contextValue;
    public readonly childTypeLabel: string = "Table";
    public readonly label: string = 'Tables';
    public readonly parent: PostgresSchemaTreeItem;

    constructor(parent: PostgresSchemaTreeItem) {
        super(parent);
    }

    public get iconPath(): string | Uri | { light: string | Uri; dark: string | Uri } {
        return getThemeAgnosticIconPath('Collection.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<PostgresTableTreeItem[]> {
        const tables: Table[] = this.parent.schema.tables;
        return tables.map(table => new PostgresTableTreeItem(this, table));
    }
}
