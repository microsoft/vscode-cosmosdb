/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from 'pg';
import pgStructure, { Schema } from 'pg-structure';
import * as vscode from 'vscode';
import { AzureParentTreeItem } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ClientConfigClass } from '../ClientConfigClass';
import { config } from '../config';
import { IPostgreSQLTreeRoot } from './IPostgreSQLTreeRoot';
import { PostgreSQLAccountTreeItem } from './PostgreSQLAccountTreeItem';
import { PostgreSQLSchemaTreeItem } from './PostgreSQLSchemaTreeItem';

export class PostgreSQLDatabaseTreeItem extends AzureParentTreeItem<IPostgreSQLTreeRoot> {
    public static contextValue: string = "postgres";
    public readonly contextValue: string = PostgreSQLDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = "Schema";
    public readonly connectionString: string;
    public readonly databaseName: string;
    public readonly parent: PostgreSQLAccountTreeItem;
    public clientConfig: ClientConfigClass;

    constructor(parent: PostgreSQLAccountTreeItem, databaseName: string, host: string, connectionString?: string) {
        super(parent);
        this.databaseName = databaseName;
        this.clientConfig = new ClientConfigClass(host);
        this.clientConfig.setDatabase(this.databaseName);
        this.clientConfig.setCredentials(config);
        this.clientConfig.setSSLConfig(config.ssl);
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
        const accountConnection = new Client(this.clientConfig);
        const db = await pgStructure(accountConnection);
        return db.schemas;
    }

}
