/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import PostgreSQLManagementClient from 'azure-arm-postgresql';
import { ClientConfig } from 'pg';
import { dropdb } from 'pgtools';
import { AzExtTreeItem, AzureParentTreeItem, createAzureClient, GenericTreeItem, IParsedError, ISubscriptionContext, parseError, TreeItemIconPath } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
import { azureUtils } from '../../utils/azureUtils';
import { localize } from '../../utils/localize';
import { getClientConfig } from '../getClientConfig';
import { PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';
import { PostgresServerTreeItem } from './PostgresServerTreeItem';
import { PostgresStoredProceduresTreeItem } from './PostgresStoredProceduresTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';

export const invalidCredentialsErrorType: string = '28P01';
export const firewallNotConfiguredErrorType: string = '28000';

export class PostgresDatabaseTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresDatabase";
    public readonly contextValue: string = PostgresDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = "Resource Type";
    public readonly databaseName: string;
    public readonly parent: PostgresServerTreeItem;
    public autoSelectInTreeItemPicker: boolean = true;

    constructor(parent: PostgresServerTreeItem, databaseName: string) {
        super(parent);
        this.databaseName = databaseName;
    }

    public get label(): string {
        return this.databaseName;
    }

    public get description(): string {
        return ext.connectedPostgresDB?.fullId === this.fullId ? localize('connected', 'Connected') : '';
    }

    public get id(): string {
        return this.databaseName;
    }

    public get iconPath(): TreeItemIconPath {
        return getThemeAgnosticIconPath('Database.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        try {
            const clientConfig: ClientConfig = await getClientConfig(this.parent, this.databaseName);
            const children: AzExtTreeItem[] = [
                new PostgresFunctionsTreeItem(this, clientConfig),
                new PostgresTablesTreeItem(this, clientConfig)
            ];

            if (this.parent.supportsStoredProcedures()) {
                children.push(new PostgresStoredProceduresTreeItem(this, clientConfig));
            }

            return children;
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (parsedError.errorType === invalidCredentialsErrorType) {
                // tslint:disable-next-line: no-floating-promises
                ext.ui.showWarningMessage(localize('couldNotConnect', 'Could not connect to "{0}": {1}', this.parent.label, parsedError.message));
            } else if (parsedError.errorType === firewallNotConfiguredErrorType) {
                const firewallTreeItem: AzExtTreeItem = new GenericTreeItem(this, {
                    contextValue: 'postgresFirewall',
                    label: localize('configureFirewall', 'Configure firewall to connect to "{0}"...', this.parent.label),
                    commandId: 'postgreSQL.configureFirewall'
                });
                firewallTreeItem.commandArgs = [this.parent];
                return [firewallTreeItem];
            } else {
                throw error;
            }
        }

        const credentialsTreeItem: AzExtTreeItem = new GenericTreeItem(this, {
            contextValue: 'postgresCredentials',
            label: localize('enterCredentials', 'Enter server credentials to connect to "{0}"...', this.parent.label),
            commandId: 'postgreSQL.enterCredentials'
        });
        credentialsTreeItem.commandArgs = [this.parent];
        return [credentialsTreeItem];
    }

    public async deleteTreeItemImpl(): Promise<void> {
        if (this.parent.server) {
            const client: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
            await client.databases.deleteMethod(azureUtils.getResourceGroupFromId(this.fullId), this.parent.name, this.databaseName);
        } else {
            const username_connString = this.parent.connectionString.username;
            const password_connString = this.parent.connectionString.password;
            const host = this.parent.connectionString.hostName;
            const config = { user: username_connString, password: password_connString, host, port: 5432 };
            try {
                await dropdb(config, this.databaseName);
            } catch (error) {
                throw error;
            }
        }

    }
}
