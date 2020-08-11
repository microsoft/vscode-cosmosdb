/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { Database, DatabaseListResult, Server } from 'azure-arm-postgresql/lib/models';
import { ClientConfig, Pool, QueryResult } from "pg";
import { createdb } from 'pgtools';
import { coerce, gte, SemVer } from 'semver';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureParentTreeItem, createAzureClient, ICreateChildImplContext, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { azureUtils } from '../../utils/azureUtils';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { getClientConfig } from '../getClientConfig';
import { ParsedPostgresConnectionString } from '../postgresConnectionStrings';
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';
import { PostgresFunctionTreeItem } from './PostgresFunctionTreeItem';
import { PostgresStoredProceduresTreeItem } from './PostgresStoredProceduresTreeItem';
import { PostgresStoredProcedureTreeItem } from './PostgresStoredProcedureTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';
import { PostgresTableTreeItem } from './PostgresTableTreeItem';

interface IPersistedServer {
    id: string;
    username: string;
}

export class PostgresServerTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresServer";
    public static serviceName: string = "ms-azuretools.vscode-azuredatabases.postgresPasswords";
    public readonly contextValue: string = PostgresServerTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly server: Server;
    public readonly connectionString: ParsedPostgresConnectionString;
    public resourceGroup: string;

    private _serverId: string;

    constructor(parent: AzureParentTreeItem, server?: Server, connectionString?: ParsedPostgresConnectionString) {
        super(parent);
        if (server) {
            this.server = server;
            this._serverId = nonNullProp(this.server, 'id');
            this.resourceGroup = azureUtils.getResourceGroupFromId(this.fullId);
        } else if (connectionString) {
            this.connectionString = connectionString;
        }
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('PostgresServer.svg');
    }

    public get label(): string {
        if (this.server) {
            return this.name;
        }
        return this.id;
    }

    public get name(): string {
        if (this.connectionString) {
            if (!this.connectionString.accountConnection) {
                return this.connectionString.fullId;
            } else {
                return this.connectionString.accountId;
            }
        }
        return nonNullProp(this.server, 'name');
    }

    public get id(): string {
        if (this.connectionString) {
            return nonNullProp(this.connectionString, 'fullId');
        }
        return nonNullProp(this.server, 'id');
    }

    public get description(): string | undefined {
        return "PostgreSQL";
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (this.connectionString) {
            const config: ClientConfig = await getClientConfig(this, 'postgres');
            const pool = new Pool(config);
            let queryResult: QueryResult;
            if (!this.connectionString.accountConnection) {
                const query = `SELECT datname FROM pg_catalog.pg_database WHERE datistemplate = false and datname = '` + nonNullProp(this.connectionString, 'databaseName') + `';`;
                queryResult = await pool.query(query);
            } else {
                queryResult = await pool.query(`SELECT datname FROM pg_catalog.pg_database WHERE datistemplate = false;`);
            }
            const listOfDatabases = queryResult.rows;
            return this.createTreeItemsWithErrorHandling(
                listOfDatabases,
                'invalidPostgresServer',
                (database) => {
                    return database.datname && !['azure_maintenance', 'azure_sys'].includes(database.datname) ? new PostgresDatabaseTreeItem(this, database.datname) : undefined;
                },
                (database) => database.datname
            );
        } else {
            const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
            const listOfDatabases: DatabaseListResult = await client.databases.listByServer(this.resourceGroup, this.name);
            return this.createTreeItemsWithErrorHandling(
                listOfDatabases,
                'invalidPostgresServer',
                (database) => {
                    return database.name && !['azure_maintenance', 'azure_sys'].includes(database.name) ? new PostgresDatabaseTreeItem(this, database.name) : undefined;
                },
                (database) => database.name
            );
        }
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            case PostgresDatabaseTreeItem.contextValue:
            case PostgresTablesTreeItem.contextValue:
            case PostgresTableTreeItem.contextValue:
            case PostgresFunctionsTreeItem.contextValue:
            case PostgresFunctionTreeItem.contextValue:
            case PostgresStoredProceduresTreeItem.contextValue:
            case PostgresStoredProcedureTreeItem.contextValue:
                return true;
            default:
                return false;
        }
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<PostgresDatabaseTreeItem> {
        const getChildrenTask: Promise<AzExtTreeItem[]> = this.getCachedChildren(context);
        const databaseName = await ext.ui.showInputBox({
            placeHolder: "Database Name",
            prompt: "Enter the name of the database",
            validateInput: (name: string) => validateDatabaseName(name, getChildrenTask)
        });
        if (this.server) {
            const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
            context.showCreatingTreeItem(databaseName);
            const database: Database = { name: databaseName };
            await client.databases.createOrUpdate(this.resourceGroup, this.name, databaseName, database);
        } else {
            const config: ClientConfig = await getClientConfig(this, databaseName);
            context.showCreatingTreeItem(databaseName);
            await createdb(config, databaseName, (err: string) => {
                if (err) {
                    console.error(err);
                    process.exit(-1);
                }
            });
        }
        return new PostgresDatabaseTreeItem(this, databaseName);
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        const deletingMessage: string = `Deleting server "${this.name}"...`;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: deletingMessage }, async () => {
            await client.servers.deleteMethod(this.resourceGroup, this.name);
            await this.deletePostgresCredentials();
        });
    }

    public async getCredentials(): Promise<{ username: string | undefined, password: string | undefined }> {
        let username: string | undefined;
        let password: string | undefined;

        if (this.server) {
            const storedValue: string | undefined = ext.context.globalState.get(PostgresServerTreeItem.serviceName);
            if (storedValue && ext.keytar) {
                const servers: IPersistedServer[] = JSON.parse(storedValue);
                for (const server of servers) {
                    if (server.id === this._serverId) {
                        username = server.username;
                        password = await ext.keytar.getPassword(PostgresServerTreeItem.serviceName, this._serverId) || undefined;
                        break;
                    }
                }
            }
        }

        return { username, password };
    }

    public supportsStoredProcedures(): boolean {
        // `semver.gte` complains when a version doesn't have decimals (i.e. "10"), so attempt to convert version to SemVer
        let version: SemVer | null;
        if (this.server) {
            version = coerce(this.server.version);
        }
        return !!version && gte(version, '11.0.0');
    }

    private async deletePostgresCredentials(): Promise<void> {
        if (ext.keytar) {
            const serviceName: string = PostgresServerTreeItem.serviceName;
            const storedValue: string | undefined = ext.context.globalState.get(serviceName);
            let servers: IPersistedServer[] = storedValue ? JSON.parse(storedValue) : [];

            // Remove this server from the cache
            servers = servers.filter((server: IPersistedServer) => { return server.id !== this.id; });

            await ext.context.globalState.update(serviceName, JSON.stringify(servers));
            await ext.keytar.deletePassword(serviceName, this.id);
        }
    }
}

async function validateDatabaseName(name: string, getChildrenTask: Promise<AzExtTreeItem[]>): Promise<string | undefined | null> {
    if (!name) {
        return localize('NameCannotBeEmpty', 'Name cannot be empty.');
    }
    const currDatabaseList = await getChildrenTask;
    const currDatabaseNames: string[] = [];
    for (const db of currDatabaseList) {
        if (db instanceof PostgresDatabaseTreeItem) {
            currDatabaseNames.push(db.databaseName);
        }
    }
    if (currDatabaseNames.includes(name)) {
        return localize('NameExists', 'Database "{0}" already exists.', name);
    }
    return undefined;
}
