/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as SingleModels from '@azure/arm-postgresql';
import type * as FlexibleModels from '@azure/arm-postgresql-flexible';
import { getResourceGroupFromId, parseAzureResourceId, uiUtils } from '@microsoft/vscode-azext-azureutils';
import {
    AzExtParentTreeItem,
    type AzExtTreeItem,
    type IActionContext,
    type ICreateChildImplContext,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { type ClientConfig } from 'pg';
import { coerce, gte, type SemVer } from 'semver';
import * as vscode from 'vscode';
import { getThemeAgnosticIconPath, postgresDefaultDatabase } from '../../constants';
import { ext } from '../../extensionVariables';
import { isIpInRanges } from '../../utils/getIp';
import { getSecretStorageKey } from '../../utils/getSecretStorageKey';
import { nonNullProp } from '../../utils/nonNull';
import { createAbstractPostgresClient, type AbstractPostgresClient } from '../abstract/AbstractPostgresClient';
import { PostgresServerType, type PostgresAbstractServer } from '../abstract/models';
import { getPublicIp } from '../commands/configurePostgresFirewall';
import { type ParsedPostgresConnectionString } from '../postgresConnectionStrings';
import { runPostgresQuery, wrapArgInQuotes } from '../runPostgresQuery';
import { PostgresClientConfigFactory } from './ClientConfigFactory';
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresFunctionTreeItem } from './PostgresFunctionTreeItem';
import { PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';
import { PostgresStoredProcedureTreeItem } from './PostgresStoredProcedureTreeItem';
import { PostgresStoredProceduresTreeItem } from './PostgresStoredProceduresTreeItem';
import { PostgresTableTreeItem } from './PostgresTableTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';

interface IPersistedServer {
    id: string;
    username: string;
}

export class PostgresServerTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'postgresServer';
    public static serviceName: string = 'ms-azuretools.vscode-azuredatabases.postgresPasswords';
    public static ipAddr: string | undefined;

    public readonly contextValue: string = PostgresServerTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Database';
    public readonly serverType: PostgresServerType;

    public resourceGroup: string | undefined;
    public azureName: string | undefined;
    public partialConnectionString: ParsedPostgresConnectionString;

    public azureId: string | undefined;
    public serverVersion: string | undefined;

    constructor(
        parent: AzExtParentTreeItem,
        connectionString: ParsedPostgresConnectionString,
        server?: PostgresAbstractServer,
    ) {
        super(parent);
        this.partialConnectionString = connectionString;
        if (server) {
            this.azureId = server?.id;
            this.serverVersion = server?.version;
            this.resourceGroup = getResourceGroupFromId(this.fullId);
            this.azureName = server?.name;
            this.serverType = parseAzureResourceId(this.fullId).provider.toLowerCase().includes('flexible')
                ? PostgresServerType.Flexible
                : PostgresServerType.Single;
        }
        this.valuesToMask.push(
            connectionString.accountId,
            connectionString.connectionString,
            connectionString.fullId,
            connectionString.hostName,
            connectionString.port,
        );
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
        if (this.azureId) {
            return this.azureId;
        }
        return this.partialConnectionString.fullId;
    }

    public get description(): string | undefined {
        switch (this.serverType) {
            case PostgresServerType.Flexible:
                return 'PostgreSQL Flexible';
            case PostgresServerType.Single:
                return 'PostgreSQL Single';
            default:
                return 'PostgreSQL';
        }
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        context.telemetry.properties.serverType = this.serverType;
        let dbNames: (string | undefined)[];
        if (this.azureName) {
            const client: AbstractPostgresClient = await createAbstractPostgresClient(this.serverType, [
                context,
                this.subscription,
            ]);
            const listOfDatabases: (SingleModels.Database | FlexibleModels.Database)[] = await uiUtils.listAllIterator(
                client.databases.listByServer(nonNullProp(this, 'resourceGroup'), nonNullProp(this, 'azureName')),
            );
            dbNames = listOfDatabases.map((db) => db.name);
        } else if (this.partialConnectionString.databaseName) {
            dbNames = [this.partialConnectionString.databaseName];
        } else {
            const { clientConfig } = await PostgresClientConfigFactory.getClientConfigFromNode(
                this,
                postgresDefaultDatabase,
            );
            const query = `SELECT datname FROM pg_catalog.pg_database WHERE datistemplate = false;`;
            const queryResult = await runPostgresQuery(clientConfig, query);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return
            dbNames = queryResult.rows.map((db) => db?.datname);
        }

        return this.createTreeItemsWithErrorHandling(
            dbNames,
            'invalidPostgresServer',
            (dbName) =>
                dbName && !['azure_maintenance', 'azure_sys'].includes(dbName)
                    ? new PostgresDatabaseTreeItem(this, dbName)
                    : undefined,
            (dbName) => dbName,
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
            throw new Error(l10n.t(`This attached account does not have permissions to create a database.`));
        }
        const getChildrenTask: Promise<AzExtTreeItem[]> = this.getCachedChildren(context);
        const databaseName = await context.ui.showInputBox({
            placeHolder: l10n.t('Database Name'),
            prompt: l10n.t('Enter the name of the database'),
            stepName: 'createPostgresDatabase',
            validateInput: (name: string) => validateDatabaseName(name, getChildrenTask),
        });
        const { clientConfig } = await PostgresClientConfigFactory.getClientConfigFromNode(
            this,
            postgresDefaultDatabase,
        );
        context.showCreatingTreeItem(databaseName);
        await runPostgresQuery(clientConfig, `Create Database ${wrapArgInQuotes(databaseName)};`);
        return new PostgresDatabaseTreeItem(this, databaseName);
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const client = await createAbstractPostgresClient(this.serverType, [context, this.subscription]);
        const deletingMessage: string = l10n.t('Deleting server "{name}"…', { name: this.label });
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title: deletingMessage },
            async () => {
                await client.servers.beginDeleteAndWait(
                    nonNullProp(this, 'resourceGroup'),
                    nonNullProp(this, 'azureName'),
                );
                await this.deletePostgresCredentials();

                const deleteMessage = l10n.t('Successfully deleted server "{name}".', { name: this.label });
                void vscode.window.showInformationMessage(deleteMessage);
                ext.outputChannel.appendLog(deleteMessage);
            },
        );
    }

    public setCredentials(username: string, password: string): void {
        this.partialConnectionString.username = username;
        this.partialConnectionString.password = password;
    }

    public async supportsStoredProcedures(clientConfig: ClientConfig): Promise<boolean> {
        // `semver.gte` complains when a version doesn't have decimals (i.e. "10"), so attempt to convert version to SemVer
        if (!this.serverVersion) {
            const result = await runPostgresQuery(clientConfig, `SHOW server_version;`);
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            this.serverVersion = result.rows[0].server_version;
        }

        const version: SemVer | null = coerce(this.serverVersion);

        // hot-fix added after a package upgrade. gte(..) didn't accept a 'null' anymore
        if (version === null) {
            return false;
        }

        return gte(version, '11.0.0');
    }

    public async deletePostgresCredentials(): Promise<void> {
        const serviceName: string = PostgresServerTreeItem.serviceName;
        const storedValue: string | undefined = ext.context.globalState.get(serviceName);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        let servers: IPersistedServer[] = storedValue ? JSON.parse(storedValue) : [];

        // Remove this server from the cache
        servers = servers.filter((server: IPersistedServer) => {
            return server.id !== this.id;
        });

        await ext.context.globalState.update(serviceName, JSON.stringify(servers));
        await ext.secretStorage.delete(getSecretStorageKey(serviceName, this.id));
    }

    public async getFullConnectionString(): Promise<ParsedPostgresConnectionString> {
        if (this.azureId && !(this.partialConnectionString.username && this.partialConnectionString.password)) {
            const storedValue: string | undefined = ext.context.globalState.get(PostgresServerTreeItem.serviceName);
            if (storedValue) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const servers: IPersistedServer[] = JSON.parse(storedValue);
                for (const server of servers) {
                    if (server.id === this.id) {
                        this.partialConnectionString.username = server.username;
                        // Migration from keytar isn't necessary, the user will automatically be prompted to reenter credentials
                        this.partialConnectionString.password =
                            (await ext.secretStorage.get(
                                getSecretStorageKey(PostgresServerTreeItem.serviceName, this.id),
                            )) || undefined;
                        break;
                    }
                }
            }
        }
        return this.partialConnectionString;
    }

    /**
     * @returns true if we believe the firewall allows the current IP to connect to database server.
     */
    public async isFirewallRuleSet(context: IActionContext): Promise<boolean> {
        try {
            const serverType: PostgresServerType = nonNullProp(this, 'serverType');
            const client: AbstractPostgresClient = await createAbstractPostgresClient(serverType, [
                context,
                this.subscription,
            ]);
            const results: SingleModels.FirewallRule[] = await uiUtils.listAllIterator(
                client.firewallRules.listByServer(nonNullProp(this, 'resourceGroup'), nonNullProp(this, 'azureName')),
            );
            const publicIp: string = await getPublicIp(context);

            // Cache/update the ip address for potential error reporting.
            PostgresServerTreeItem.ipAddr = publicIp;

            return isIpInRanges(publicIp, results);
        } catch {
            // We cannot get the firewall rules from attached databases because we cannot get the subscription object.
            // We assume the database server has configured the necessary firewall rules to allow connections from the current IP.
            return true;
        }
    }
}

async function validateDatabaseName(
    name: string,
    getChildrenTask: Promise<AzExtTreeItem[]>,
): Promise<string | undefined | null> {
    if (!name) {
        return l10n.t('Name cannot be empty.');
    }
    const currDatabaseList = await getChildrenTask;
    const currDatabaseNames: string[] = [];
    for (const db of currDatabaseList) {
        if (db instanceof PostgresDatabaseTreeItem) {
            currDatabaseNames.push(db.databaseName);
        }
    }
    if (currDatabaseNames.includes(name)) {
        return l10n.t('Database "{name}" already exists.', { name });
    }
    return undefined;
}
