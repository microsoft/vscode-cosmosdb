/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzExtParentTreeItem,
    createContextValue,
    GenericTreeItem,
    parseError,
    type AzExtTreeItem,
    type IActionContext,
    type IParsedError,
    type TreeItemIconPath,
} from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { ext } from '../../extensionVariables';
import { firewallNotConfiguredErrorType, invalidCredentialsErrorType } from '../postgresConstants';
import { runPostgresQuery, wrapArgInQuotes } from '../runPostgresQuery';
import { PostgresClientConfigFactory } from './ClientConfigFactory';
import { PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';
import { type PostgresServerTreeItem } from './PostgresServerTreeItem';
import { PostgresStoredProceduresTreeItem } from './PostgresStoredProceduresTreeItem';
import { PostgresTablesTreeItem } from './PostgresTablesTreeItem';

export class PostgresDatabaseTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'postgresDatabase';
    public contextValue: string = PostgresDatabaseTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Resource Type';
    public readonly databaseName: string;
    declare public readonly parent: PostgresServerTreeItem;
    public autoSelectInTreeItemPicker: boolean = true;
    public isShowingPasswordWarning: boolean;

    constructor(parent: PostgresServerTreeItem, databaseName: string) {
        super(parent);
        this.databaseName = databaseName;
        this.isShowingPasswordWarning = false;
    }

    public get label(): string {
        return this.databaseName;
    }

    public get description(): string {
        return ext.connectedPostgresDB?.fullId === this.fullId ? l10n.t('Connected') : '';
    }

    public get id(): string {
        return this.databaseName;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('database');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean, context: IActionContext): Promise<AzExtTreeItem[]> {
        const isFirewallRuleSet = await this.parent.isFirewallRuleSet(context);
        if (!isFirewallRuleSet) {
            const firewallTreeItem: AzExtTreeItem = new GenericTreeItem(this, {
                contextValue: 'postgresFirewall',
                label: l10n.t('Configure firewall to connect to "{nodeName}"…', { nodeName: this.parent.label }),
                commandId: 'postgreSQL.configureFirewall',
            });
            firewallTreeItem.commandArgs = [this.parent];
            return [firewallTreeItem];
        }

        try {
            const { type, clientConfig } = await PostgresClientConfigFactory.getClientConfigFromNode(
                this.parent,
                this.databaseName,
            );
            if (type === 'password') {
                void this.showPasswordWarning(context);
            }
            const children: AzExtTreeItem[] = [
                new PostgresFunctionsTreeItem(this, clientConfig),
                new PostgresTablesTreeItem(this, clientConfig),
            ];

            if (await this.parent.supportsStoredProcedures(clientConfig)) {
                children.push(new PostgresStoredProceduresTreeItem(this, clientConfig));
            }

            return children;
        } catch (error) {
            const parsedError: IParsedError = parseError(error);

            if (this.parent.azureName && parsedError.errorType === invalidCredentialsErrorType) {
                void context.ui.showWarningMessage(
                    l10n.t('Could not connect to "{name}": {error}', {
                        name: this.parent.label,
                        error: parsedError.message,
                    }),
                    { stepName: 'loadPostgresDatabases' },
                );
                const credentialsTreeItem: AzExtTreeItem = new GenericTreeItem(this, {
                    contextValue: 'postgresCredentials',
                    label: l10n.t('Enter server credentials to connect to "{name}"…', { name: this.parent.label }),
                    commandId: 'postgreSQL.enterCredentials',
                });
                credentialsTreeItem.commandArgs = [this.parent];
                return [credentialsTreeItem];
            } else if (this.parent.azureName && parsedError.errorType === firewallNotConfiguredErrorType) {
                void context.ui.showWarningMessage(
                    l10n.t('Could not connect to "{name}": {error}', {
                        name: this.parent.label,
                        error: parsedError.message,
                    }),
                    { stepName: 'loadPostgresDatabases' },
                );
                return [];
            } else {
                throw error;
            }
        }
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const { clientConfig } = await PostgresClientConfigFactory.getClientConfigFromNode(
            this.parent,
            this.databaseName,
        );
        await runPostgresQuery(clientConfig, `Drop Database ${wrapArgInQuotes(this.databaseName)};`);
    }

    private async showPasswordWarning(context: IActionContext): Promise<void> {
        if (this.isShowingPasswordWarning) {
            return;
        }
        this.isShowingPasswordWarning = true;
        this.contextValue = createContextValue([PostgresDatabaseTreeItem.contextValue, 'usesPassword']);
        await this.refresh(context);
    }
}
