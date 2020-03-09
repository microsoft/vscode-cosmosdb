/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureTreeItem } from 'vscode-azureextensionui';
import { getThemeAgnosticIconPath } from '../../constants';
import { getDocumentTreeItemLabel } from '../../utils/vscodeUtils';
import { IPostgreSQLTreeRoot } from './IPostgreSQLTreeRoot';
import { PostgreSQLSchemaTreeItem } from './PostgreSQLSchemaTreeItem';

export interface IPostgresTable {
    _id: number;
}

export class PostgreSQLTableTreeItem extends AzureTreeItem<IPostgreSQLTreeRoot> {
    public static contextValue: string = "PostgresTable";
    public readonly contextValue: string = PostgreSQLTableTreeItem.contextValue;
    public document: IPostgresTable;
    public readonly parent: PostgreSQLSchemaTreeItem;
    private _label: string;

    constructor(parent: PostgreSQLSchemaTreeItem, document: IPostgresTable) {
        super(parent);
        this.document = document;
        this._label = getDocumentTreeItemLabel(this.document);
    }

    public get id(): string {
        // tslint:disable-next-line:no-non-null-assertion
        return String(this.document!._id);
    }

    public get label(): string {
        return this._label;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Document.svg');
    }

}
