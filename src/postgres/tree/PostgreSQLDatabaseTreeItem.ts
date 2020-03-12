/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from 'pg';
import { ClientConfig } from 'pg';
import pgStructure, { Schema } from 'pg-structure';
import * as vscode from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { PostgreSQLServerTreeItem } from './PostgreSQLServerTreeItem';
import { PostgreSQLSchemaTreeItem } from './PostgreSQLSchemaTreeItem';

export class PostgreSQLDatabaseTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgres";
    public readonly contextValue: string = PostgreSQLDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = "Schema";
    public readonly connectionString: string;
    public readonly databaseName: string;
    public readonly parent: PostgreSQLServerTreeItem;
    public readonly host: string;
    public readonly port: number;

    constructor(parent: PostgreSQLServerTreeItem, databaseName: string, host: string, connectionString?: string) {
        super(parent);
        this.databaseName = databaseName;
        this.host = host;
        this.port = 5432;
        if (connectionString) {
            this.connectionString = connectionString;
        }
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
        const schemas: Schema[] = await this.connectToDb();
        return schemas.map(schema => new PostgreSQLSchemaTreeItem(this, schema));
    }

    public async connectToDb(): Promise<Schema[]> {
        const username: string = process.env.POSTGRES_USERNAME;
        const password: string = process.env.POSTGRES_PASSWORD;
        const sslString = process.env.POSTGRES_SSL;
        const ssl: boolean = sslString === 'true';
        const clientConfig: ClientConfig = { user: username, password: password, ssl: ssl, host: this.host, port: this.port, database: this.databaseName };
        const accountConnection = new Client(clientConfig);
        const db = await pgStructure(accountConnection);
        return db.schemas;
    }

}
