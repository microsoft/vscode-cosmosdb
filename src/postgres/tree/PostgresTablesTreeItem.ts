/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { type ClientConfig } from 'pg';
import { ThemeIcon } from 'vscode';
import { getTables, type IPostgresTable } from '../getTables';
import { type PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresResourcesTreeItemBase } from './PostgresResourcesTreeItemBase';
import { PostgresTableTreeItem } from './PostgresTableTreeItem';

export class PostgresTablesTreeItem extends PostgresResourcesTreeItemBase {
    public static contextValue: string = 'postgresTables';
    public readonly contextValue: string = PostgresTablesTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Table';
    public readonly label: string = 'Tables';
    public suppressMaskLabel = true;

    constructor(parent: PostgresDatabaseTreeItem, clientConfig: ClientConfig) {
        super(parent);
        this.clientConfig = clientConfig;
    }

    public get iconPath(): TreeItemIconPath {
        return new ThemeIcon('window');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<PostgresTableTreeItem[]> {
        const tables: IPostgresTable[] = await getTables(this.clientConfig);
        this.resourcesAndSchemas = {};
        for (const table of tables) {
            this.addResourcesAndSchemasEntry(table.name.trim(), table.schemaName);
        }
        return tables.map(
            (table) => new PostgresTableTreeItem(this, table, this.isDuplicateResource(table.name.trim())),
        );
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        return contextValue === PostgresTableTreeItem.contextValue;
    }
}
