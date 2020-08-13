/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ClientConfig, Pool } from 'pg';
import { AzExtTreeItem, AzureParentTreeItem, ISubscriptionContext, TreeItemIconPath } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { ext } from '../../extensionVariables';
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
        return 'database\/' + this.databaseName;
    }

    public get iconPath(): TreeItemIconPath {
        return getThemeAgnosticIconPath('Database.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        const clientConfig: ClientConfig = await getClientConfig(this.parent, this.databaseName);
        const children: AzExtTreeItem[] = [
            new PostgresFunctionsTreeItem(this, clientConfig),
            new PostgresTablesTreeItem(this, clientConfig)
        ];

        if (this.parent.supportsStoredProcedures()) {
            children.push(new PostgresStoredProceduresTreeItem(this, clientConfig));
        }

        return children;
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const config = await getClientConfig(this.parent, 'postgres');
        const pool = new Pool(config);
        await pool.query(`Drop Database "${this.databaseName}";`);
    }
}
