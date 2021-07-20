/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from 'pg';
import { coerce, gte, SemVer } from 'semver';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureParentTreeItem, ICreateChildImplContext, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath, IPersistedServer, postgresDefaultDatabase } from '../../constants';
import { ext } from '../../extensionVariables';
import { azureUtils } from '../../utils/azureUtils';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { createAbstractPostgresClient } from '../abstract/AbstractPostgresClient';
import { PostgresAbstractServer, PostgresServerType } from '../abstract/models';
import { getClientConfig } from '../getClientConfig';
import { ParsedPostgresConnectionString } from '../postgresConnectionStrings';
import { runPostgresQuery, wrapArgInQuotes } from '../runPostgresQuery';
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';
import { PostgresFunctionTreeItem } from './PostgresFunctionTreeItem';
import { PostgresStoredProceduresTreeItem } from './PostgresStoredProceduresTreeItem';
import { PostgresStoredProcedureTreeItem } from './PostgresStoredProcedureTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';
import { PostgresTableTreeItem } from './PostgresTableTreeItem';

export class PostgresServerTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresServer";
    public static serviceName: string = "ms-azuretools.vscode-azuredatabases.postgresPasswords";
    public readonly contextValue: string = PostgresServerTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly serverType: PostgresServerType;

    public resourceGroup: string | undefined;
    public azureName: string | undefined;
    public partialConnectionString: ParsedPostgresConnectionString;
    public persistedServer: IPersistedServer;

    private _azureId: string | undefined;
    private _serverVersion: string | undefined;

    constructor(parent: AzureParentTreeItem, connectionString: ParsedPostgresConnectionString, server?: PostgresAbstractServer) {
        super(parent);
        this.partialConnectionString = connectionString;
        if (server) {
            this._azureId = server?.id;
            this._serverVersion = server?.version;
            this.resourceGroup = azureUtils.getResourceGroupFromId(this.fullId);
            this.azureName = server?.name;
            this.serverType = nonNullProp(server, 'serverType');
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        }
        this.persistedServer = { id: this.id, username: undefined };
        this.valuesToMask.push(connectionString.accountId, connectionString.connectionString, connectionString.fullId, connectionString.hostName, connectionString.port);
        if (connectionString.databaseName) {
            this.valuesToMask.push(connectionString.databaseName);
        }
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('PostgresServer.svg');
    }

    public get label(): string {
        return this.azureName ? this.azureName : this.partialConnectionString.fullId;
    }

    public get id(): string {
        if (this._azureId) {
            return this._azureId;
        }
        return this.partialConnectionString.fullId;
    }

    public get description(): string | undefined {
        switch (this.serverType) {
            case PostgresServerType.Flexible:
                return "PostgreSQL Flexible";
            case PostgresServerType.Single:
                return "PostgreSQL Single";
            default:
                return "PostgreSQL";
        }
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        let dbNames: (string | undefined)[];
        if (this.azureName) {
            const client = createAbstractPostgresClient(this.serverType, this.root);
            const listOfDatabases = await client.databases.listByServer(nonNullProp(this, 'resourceGroup'), nonNullProp(this, 'azureName'));
            dbNames = listOfDatabases.map(db => db?.name);
        } else if (this.partialConnectionString.databaseName) {
            dbNames = [this.partialConnectionString.databaseName];
        } else {
            const config = await getClientConfig(this, postgresDefaultDatabase);
            const query = `SELECT datname FROM pg_catalog.pg_database WHERE datistemplate = false;`;
            const queryResult = await runPostgresQuery(config, query);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
            dbNames = queryResult.rows.map(db => db?.datname);
        }

        return this.createTreeItemsWithErrorHandling(
            dbNames,
            'invalidPostgresServer',
            dbName => dbName && !['azure_maintenance', 'azure_sys'].includes(dbName) ? new PostgresDatabaseTreeItem(this, dbName) : undefined,
            dbName => dbName
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
        if (this.partialConnectionString.databaseName) {
            throw new Error(localize('noPermissionToCreateDatabase', `This attached account does not have permissions to create a database.`));
        }
        const getChildrenTask: Promise<AzExtTreeItem[]> = this.getCachedChildren(context);
        const databaseName = await context.ui.showInputBox({
            placeHolder: "Database Name",
            prompt: "Enter the name of the database",
            stepName: 'createPostgresDatabase',
            validateInput: (name: string) => validateDatabaseName(name, getChildrenTask)
        });
        const config = await getClientConfig(this, postgresDefaultDatabase);
        context.showCreatingTreeItem(databaseName);
        await runPostgresQuery(config, `Create Database ${wrapArgInQuotes(databaseName)};`);
        return new PostgresDatabaseTreeItem(this, databaseName);
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const client = createAbstractPostgresClient(this.serverType, this.root);
        const deletingMessage: string = `Deleting server "${this.label}"...`;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: deletingMessage }, async () => {
            await client.servers.deleteMethod(nonNullProp(this, 'resourceGroup'), nonNullProp(this, 'azureName'));
            await this.deletePostgresCredentials();
        });
    }

    public setCredentials(username: string, password: string): void {
        this.partialConnectionString.username = username;
        this.partialConnectionString.password = password;
    }

    public async supportsStoredProcedures(clientConfig: ClientConfig): Promise<boolean> {
        // `semver.gte` complains when a version doesn't have decimals (i.e. "10"), so attempt to convert version to SemVer
        if (!this._serverVersion) {
            const result = await runPostgresQuery(clientConfig, `SHOW server_version;`);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            this._serverVersion = result.rows[0].server_version;
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
        const version: SemVer | null = coerce(this._serverVersion);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
        return gte(version, '11.0.0');
    }

    public async deletePostgresCredentials(): Promise<void> {
        if (ext.keytar) {
            const serviceName: string = PostgresServerTreeItem.serviceName;
            const storedValue: string | undefined = ext.context.globalState.get(serviceName);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            let servers: IPersistedServer[] = storedValue ? JSON.parse(storedValue) : [];

            // Remove this server from the cache
            servers = servers.filter((server: IPersistedServer) => { return server.id !== this.id; });

            await ext.context.globalState.update(serviceName, JSON.stringify(servers));
            await ext.keytar.deletePassword(serviceName, this.id);
        }
    }

    public async getFullConnectionString(): Promise<ParsedPostgresConnectionString> {

        if (this._azureId && !(this.partialConnectionString.username && this.partialConnectionString.password)) {
            if (!this.persistedServer.username) {
                this.updatePersistedServer();
            }
            if (this.persistedServer?.username && ext.keytar) {
                this.partialConnectionString.username = this.persistedServer.username;
                this.partialConnectionString.password = await ext.keytar.getPassword(PostgresServerTreeItem.serviceName, this.id) || undefined;
            }
        }
        return this.partialConnectionString;
    }

    public updatePersistedServer(username?: string, isFirewallRuleSet?: boolean): void {
        if (username || isFirewallRuleSet) {
            if (username) this.persistedServer.username = username;
            if (isFirewallRuleSet) this.persistedServer.isFirewallRuleSet = isFirewallRuleSet;
        } else {
            const storedValue: string | undefined = ext.context.globalState.get(PostgresServerTreeItem.serviceName);
            if (storedValue) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const servers: IPersistedServer[] = JSON.parse(storedValue);
                for (const server of servers) {
                    if (server.id === this.id) {
                        this.persistedServer.username = server.username;
                        if (this.persistedServer.isFirewallRuleSet) {
                            this.persistedServer.isFirewallRuleSet = server.isFirewallRuleSet;
                        }
                        break;
                    }
                }
            }
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
