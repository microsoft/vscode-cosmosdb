/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { PostgresTableTreeItem } from './PostgresTableTreeItem';

export class PostgresColumnTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = "postgresColumn";
    public readonly contextValue: string = PostgresColumnTreeItem.contextValue;
    public readonly columnName: string;
    public readonly parent: PostgresTableTreeItem;

    constructor(parent: PostgresTableTreeItem, columnName: string) {
        super(parent);
        this.columnName = columnName;
    }

    public get id(): string {
        return String(this.columnName);
    }

    public get label(): string {
        return this.columnName;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('PostgresColumn.svg');
    }

}
