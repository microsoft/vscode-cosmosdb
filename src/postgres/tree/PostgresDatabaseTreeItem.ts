/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig } from 'pg';
import { AzExtTreeItem, AzureParentTreeItem, GenericTreeItem, IParsedError, ISubscriptionContext, parseError, TreeItemIconPath } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath, postgresDefaultDatabase } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { getClientConfig } from '../getClientConfig';
import { runPostgresQuery, wrapArgInQuotes } from '../runPostgresQuery';
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
        return 'database\/' + this.databaseName;
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
            } else if (this.parent.resourceGroup && parsedError.errorType === firewallNotConfiguredErrorType) {
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
        const config = await getClientConfig(this.parent, postgresDefaultDatabase);
        await runPostgresQuery(config, `Drop Database ${wrapArgInQuotes(this.databaseName)};`);
    }
}
