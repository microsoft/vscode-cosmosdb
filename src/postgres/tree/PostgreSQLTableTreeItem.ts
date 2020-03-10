/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureTreeItem, ISubscriptionContext } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { PostgreSQLSchemaTreeItem } from './PostgreSQLSchemaTreeItem';

export interface IPostgresTable {
    _id: number;
    _name: string;
}

export class PostgreSQLTableTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = "PostgresTable";
    public readonly contextValue: string = PostgreSQLTableTreeItem.contextValue;
    public table: IPostgresTable;
    public readonly parent: PostgreSQLSchemaTreeItem;
    private _label: string;

    constructor(parent: PostgreSQLSchemaTreeItem, table: IPostgresTable) {
        super(parent);
        this.table = table;
        this._label = table._name;
    }

    public get id(): string {
        // tslint:disable-next-line:no-non-null-assertion
        return String(this.table!._id);
    }

    public get label(): string {
        return this._label;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Document.svg');
    }

}
