/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { coerce, gte, SemVer } from 'semver';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureParentTreeItem, createAzureClient, ICreateChildImplContext, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath, postgresDefaultDatabase } from '../../constants';
import { ext } from '../../extensionVariables';
import { azureUtils } from '../../utils/azureUtils';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { getClientConfig } from '../getClientConfig';
import { createPostgresConnectionString, ParsedPostgresConnectionString } from '../postgresConnectionStrings';
import { runPostgresQuery } from '../runPostgresQuery';
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
    public connectionString: ParsedPostgresConnectionString;
    public resourceGroup: string | undefined;

    private _azureId: string | undefined;
    private _serverVersion: string | undefined;
    private _azureName: string | undefined;

    constructor(parent: AzureParentTreeItem, connectionString: ParsedPostgresConnectionString, serverId?: string, serverVersion?: string, serverName?: string) {
        super(parent);
        this.connectionString = connectionString;
        this._azureId = serverId;
        this._serverVersion = serverVersion;
        if (this._azureId) {
            this.resourceGroup = azureUtils.getResourceGroupFromId(this.fullId);
            this._azureName = serverName;
        }
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('PostgresServer.svg');
    }

    public get label(): string {
        return this._azureName ? this._azureName : this.connectionString.fullId;
    }

    public get id(): string {
        if (this._azureId) {
            return this._azureId;
        }
        return this.connectionString.fullId;
    }

    public get description(): string | undefined {
        return "PostgreSQL";
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        if (!(this.connectionString.username && this.connectionString.password)) {
            const { username, password } = await this.getCredentials();
            if (username && password) {
                await this.updateConnectionString(username, password);
            }
        }
        let config;
        let query: string;
        if (this.connectionString.databaseName) {
            config = await getClientConfig(this, this.connectionString.databaseName);
            query = `SELECT datname FROM pg_catalog.pg_database WHERE datistemplate = false and datname = '` + nonNullProp(this.connectionString, 'databaseName') + `';`;
        } else {
            config = await getClientConfig(this, postgresDefaultDatabase);
            query = `SELECT datname FROM pg_catalog.pg_database WHERE datistemplate = false;`;
        }
        const queryResult = await runPostgresQuery(config, query);
        const listOfDatabases = queryResult.rows;
        return this.createTreeItemsWithErrorHandling(
            listOfDatabases,
            'invalidPostgresServer',
            (database) => {
                return database.datname && !['azure_maintenance', 'azure_sys'].includes(database.datname) ? new PostgresDatabaseTreeItem(this, database.datname) : undefined;
            },
            (database) => database.datname
        );
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
        if (this.connectionString.databaseName) {
            throw new Error(localize('noPermissionToCreateDatabase', `This attached account does not have permissions to create a database.`));
        }
        const getChildrenTask: Promise<AzExtTreeItem[]> = this.getCachedChildren(context);
        const databaseName = await ext.ui.showInputBox({
            placeHolder: "Database Name",
            prompt: "Enter the name of the database",
            validateInput: (name: string) => validateDatabaseName(name, getChildrenTask)
        });
        const config = await getClientConfig(this, postgresDefaultDatabase);
        context.showCreatingTreeItem(databaseName);
        await runPostgresQuery(config, `Create Database "${databaseName}";`);
        return new PostgresDatabaseTreeItem(this, databaseName);
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        const deletingMessage: string = `Deleting server "${this.label}"...`;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: deletingMessage }, async () => {
            await client.servers.deleteMethod(nonNullProp(this, 'resourceGroup'), this.label);
            await this.deletePostgresCredentials();
        });
    }

    public async getCredentials(): Promise<{ username: string | undefined, password: string | undefined }> {
        let username: string | undefined;
        let password: string | undefined;

        if (this._azureId) {
            const storedValue: string | undefined = ext.context.globalState.get(PostgresServerTreeItem.serviceName);
            if (storedValue && ext.keytar) {
                const servers: IPersistedServer[] = JSON.parse(storedValue);
                for (const server of servers) {
                    if (server.id === this.id) {
                        username = server.username;
                        password = await ext.keytar.getPassword(PostgresServerTreeItem.serviceName, this.id) || undefined;
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
        if (this._serverVersion) {
            version = coerce(this._serverVersion);
        }
        return !!version && gte(version, '11.0.0');
    }

    public async updateConnectionString(username: string, password: string): Promise<void> {
        const host = this.connectionString.hostName;
        this.connectionString = createPostgresConnectionString(host, username, password);
    }

    public async deletePostgresCredentials(): Promise<void> {
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
