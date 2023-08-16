/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { FirewallRule } from '@azure/arm-postgresql';
import { uiUtils } from '@microsoft/vscode-azext-azureutils';
import { AzExtParentTreeItem, AzExtTreeItem, GenericTreeItem, IActionContext, IParsedError, parseError, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { ClientConfig } from 'pg';
import { ThemeIcon } from 'vscode';
import { postgresDefaultDatabase } from '../../constants';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { AbstractPostgresClient, createAbstractPostgresClient } from '../abstract/AbstractPostgresClient';
import { PostgresServerType } from '../abstract/models';
import { getPublicIp } from '../commands/configurePostgresFirewall';
import { getClientConfigWithValidation } from '../getClientConfig';
import { firewallNotConfiguredErrorType, invalidCredentialsErrorType } from '../postgresConstants';
import { runPostgresQuery, wrapArgInQuotes } from '../runPostgresQuery';
import { PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';
import { PostgresServerTreeItem } from './PostgresServerTreeItem';
import { PostgresStoredProceduresTreeItem } from './PostgresStoredProceduresTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';

export class PostgresDatabaseTreeItem extends AzExtParentTreeItem {
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
        return new ThemeIcon('database');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        try {
            const serverTreeItem = this.parent;
            const parsedConnectionString = await serverTreeItem.getFullConnectionString();
            const clientConfig: ClientConfig | undefined = await getClientConfigWithValidation(parsedConnectionString, serverTreeItem.serverType, !!serverTreeItem.azureName, this.databaseName);
            const children: AzExtTreeItem[] = [
                new PostgresFunctionsTreeItem(this, clientConfig),
                new PostgresTablesTreeItem(this, clientConfig)
            ];

            if (await this.parent.supportsStoredProcedures(clientConfig)) {
                children.push(new PostgresStoredProceduresTreeItem(this, clientConfig));
            }

            return children;
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (this.parent.azureName && parsedError.errorType === invalidCredentialsErrorType) {
                void context.ui.showWarningMessage(localize('couldNotConnect', 'Could not connect to "{0}": {1}', this.parent.label, parsedError.message), { stepName: 'loadPostgresDatabases' });
                const credentialsTreeItem: AzExtTreeItem = new GenericTreeItem(this, {
                    contextValue: 'postgresCredentials',
                    label: localize('enterCredentials', 'Enter server credentials to connect to "{0}"...', this.parent.label),
                    commandId: 'postgreSQL.enterCredentials'
                });
                credentialsTreeItem.commandArgs = [this.parent];
                return [credentialsTreeItem];
            } else if (this.parent.azureName && (parsedError.errorType === firewallNotConfiguredErrorType || (parsedError.errorType === 'ETIMEDOUT' && !(await this.isFirewallRuleSet(context, this.parent))))) {
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
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const serverTreeItem = this.parent;
        const parsedConnectionString = await serverTreeItem.getFullConnectionString();
        const clientConfig = await getClientConfigWithValidation(parsedConnectionString, serverTreeItem.serverType, !!serverTreeItem.azureName, postgresDefaultDatabase);
        await runPostgresQuery(clientConfig, `Drop Database ${wrapArgInQuotes(this.databaseName)};`);
    }

    // Flexible servers throw a generic 'ETIMEDOUT' error instead of the firewall-specific error, so we have to check the firewall rules
    public async isFirewallRuleSet(context: IActionContext, treeItem: PostgresServerTreeItem): Promise<boolean> {
        const serverType: PostgresServerType = nonNullProp(treeItem, 'serverType');
        const client: AbstractPostgresClient = await createAbstractPostgresClient(serverType, [context, treeItem.subscription]);
        const results: FirewallRule[] = (await uiUtils.listAllIterator(client.firewallRules.listByServer(nonNullProp(treeItem, 'resourceGroup'), nonNullProp(treeItem, 'azureName'))));
        const publicIp: string = await getPublicIp(context);
        return (results.some((value: FirewallRule) => value.startIpAddress === publicIp));
    }
}
