/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from 'pg';
import { ClientConfig } from 'pg';
import pgStructure from 'pg-structure';
import * as vscode from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { PostgreSQLSchemaTreeItem } from './PostgreSQLSchemaTreeItem';
import { PostgreSQLServerTreeItem } from './PostgreSQLServerTreeItem';

export class PostgreSQLDatabaseTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresDatabase";
    public readonly contextValue: string = PostgreSQLDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = "Schema";
    public readonly databaseName: string;
    public readonly parent: PostgreSQLServerTreeItem;

    constructor(parent: PostgreSQLServerTreeItem, databaseName: string) {
        super(parent);
        this.databaseName = databaseName;
    }

    public get label(): string {
        return this.databaseName;
    }

    public get id(): string {
        return this.databaseName;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Database.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<PostgreSQLSchemaTreeItem[]> {
        const username: string = process.env.POSTGRES_USERNAME;
        const password: string = process.env.POSTGRES_PASSWORD;
        const sslString = process.env.POSTGRES_SSL;
        const ssl: boolean = sslString === 'true';
        const host: string = this.parent.server.fullyQualifiedDomainName;
        const clientConfig: ClientConfig = { user: username, password: password, ssl: ssl, host: host, port: 5432, database: this.databaseName };
        const accountConnection = new Client(clientConfig);
        const db = await pgStructure(accountConnection);
        return db.schemas.map(schema => new PostgreSQLSchemaTreeItem(this, schema));
    }
}
