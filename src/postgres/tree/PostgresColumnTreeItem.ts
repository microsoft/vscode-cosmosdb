/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { PostgresTableTreeItem } from './PostgresTableTreeItem';

export class PostgresColumnTreeItem extends AzExtTreeItem {
    public static contextValue: string = "postgresColumn";
    public readonly contextValue: string = PostgresColumnTreeItem.contextValue;
    public readonly columnName: string;
    public readonly parent: PostgresTableTreeItem;

    constructor(parent: PostgresTableTreeItem, columnName: string) {
        super(parent);
        this.columnName = columnName;
    }

    public get id(): string {
        return this.columnName;
    }

    public get label(): string {
        return this.columnName;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('split-horizontal');
    }

}
