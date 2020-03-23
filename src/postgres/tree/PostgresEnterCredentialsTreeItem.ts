/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { localize } from "../../utils/localize";
import { PostgresDatabaseTreeItem } from "./PostgresDatabaseTreeItem";

export class PostgresEnterCredentialsTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresCredentials';
    public readonly contextValue: string = PostgresEnterCredentialsTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.getPostgresCredentials';
    public readonly parent: PostgresDatabaseTreeItem;

    constructor(parent: PostgresDatabaseTreeItem) {
        super(parent);
    }

    public get label(): string {
        return localize('enterCredentials', 'Enter server credentials to connect to "{0}"...', this.parent.label);
    }
}
