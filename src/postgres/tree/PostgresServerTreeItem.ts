/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { Database, DatabaseListResult, Server } from 'azure-arm-postgresql/lib/models';
import { coerce, gte, SemVer } from 'semver';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureParentTreeItem, createAzureClient, ICreateChildImplContext, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { azureUtils } from '../../utils/azureUtils';
import { KeyTar, tryGetKeyTar } from '../../utils/keytar';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';
import { PostgresFunctionTreeItem } from './PostgresFunctionTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';
import { PostgresTableTreeItem } from './PostgresTableTreeItem';

interface IPersistedServer {
    id: string;
    username: string;
}

export class PostgresServerTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresServer";
    public readonly contextValue: string = PostgresServerTreeItem.contextValue;
    public readonly childTypeLabel: string = "Database";
    public readonly server: Server;
    public resourceGroup: string;

    private readonly _serviceName: string = "ms-azuretools.vscode-cosmosdb.postgresPasswords";
    private _keytar: KeyTar | undefined;
    private _serverId: string;

    constructor(parent: AzureParentTreeItem, server: Server) {
        super(parent);
        this.server = server;
        this._keytar = tryGetKeyTar();
        this._serverId = nonNullProp(this.server, 'id');
        this.resourceGroup = azureUtils.getResourceGroupFromId(this.fullId);
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('PostgresServer.svg');
    }

    public get label(): string {
        return this.name;
    }

    public get name(): string {
        return nonNullProp(this.server, 'name');
    }

    public get id(): string {
        return nonNullProp(this.server, 'id');
    }

    public get description(): string | undefined {
        return "PostgreSQL";
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
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

    public isAncestorOfImpl(contextValue: string): boolean {
        switch (contextValue) {
            case PostgresDatabaseTreeItem.contextValue:
            case PostgresTablesTreeItem.contextValue:
            case PostgresTableTreeItem.contextValue:
            case PostgresFunctionsTreeItem.contextValue:
            case PostgresFunctionTreeItem.contextValue:
                return true;
            default:
                return false;
        }
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<PostgresDatabaseTreeItem> {
        const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        const getChildrenTask: Promise<AzExtTreeItem[]> = this.getCachedChildren(context);
        const databaseName = await ext.ui.showInputBox({
            placeHolder: "Database Name",
            prompt: "Enter the name of the database",
            validateInput: (name: string) => validateDatabaseName(name, getChildrenTask)
        });
        context.showCreatingTreeItem(databaseName);
        const database: Database = { name: databaseName };
        await client.databases.createOrUpdate(this.resourceGroup, this.name, databaseName, database);
        return new PostgresDatabaseTreeItem(this, databaseName);
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        const deletingMessage: string = `Deleting server "${this.name}"...`;
        await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: deletingMessage }, async () => {
            await client.servers.deleteMethod(this.resourceGroup, this.name);
        });
    }

    public async getCredentials(): Promise<{ username: string | undefined, password: string | undefined }> {
        let username: string | undefined;
        let password: string | undefined;

        const storedValue: string | undefined = ext.context.globalState.get(this._serviceName);
        if (storedValue && this._keytar) {
            const servers: IPersistedServer[] = JSON.parse(storedValue);
            for (const server of servers) {
                if (server.id === this._serverId) {
                    username = server.username;
                    password = await this._keytar.getPassword(this._serviceName, this._serverId) || undefined;
                    break;
                }
            }
        }

        return { username, password };
    }

    public async setCredentials(username: string, password: string): Promise<void> {
        if (this._keytar) {
            const storedValue: string | undefined = ext.context.globalState.get(this._serviceName);
            let servers: IPersistedServer[] = storedValue ? JSON.parse(storedValue) : [];

            // Remove this server from the cache if it's there
            servers = servers.filter((server: IPersistedServer) => { return server.id !== this._serverId; });

            const newServer: IPersistedServer = {
                id: this._serverId,
                username
            };
            servers.push(newServer);
            await ext.context.globalState.update(this._serviceName, JSON.stringify(servers));
            await this._keytar.setPassword(this._serviceName, this._serverId, password);
        }
    }

    public supportsStoredProcedures(): boolean {
        // `semver.gte` complains when a version doesn't have decimals (i.e. "10"), so attempt to convert version to SemVer
        const version: SemVer | null = coerce(this.server.version);
        return !!version && gte(version, '11.0.0');
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
