/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { type ClientConfig } from 'pg';
import * as vscode from 'vscode';
import { getPostgresProcedureQueryRows, type IPostgresProceduresQueryRow } from '../getPostgresProcedureQueryRows';
import { type PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresFunctionTreeItem } from './PostgresFunctionTreeItem';
import { PostgresResourcesTreeItemBase } from './PostgresResourcesTreeItemBase';

export class PostgresFunctionsTreeItem extends PostgresResourcesTreeItemBase {
    public static contextValue: string = 'postgresFunctions';
    public readonly contextValue: string = PostgresFunctionsTreeItem.contextValue;
    public readonly label: string = 'Functions';
    public readonly childTypeLabel: string = 'Function';
    public suppressMaskLabel = true;

    constructor(parent: PostgresDatabaseTreeItem, clientConfig: ClientConfig) {
        super(parent);
        this.clientConfig = clientConfig;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('symbol-function');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<PostgresFunctionTreeItem[]> {
        const rows: IPostgresProceduresQueryRow[] = await getPostgresProcedureQueryRows(this);
        return rows.map((row) => new PostgresFunctionTreeItem(this, row, this.isDuplicateResource(row.name)));
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        return contextValue === PostgresFunctionTreeItem.contextValue;
    }
}
