/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import  { type ClientConfig } from 'pg';
import { ThemeIcon } from 'vscode';
import  { type IPostgresProceduresQueryRow } from '../getPostgresProcedureQueryRows';
import { getPostgresProcedureQueryRows } from '../getPostgresProcedureQueryRows';
import  { type PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { PostgresResourcesTreeItemBase } from './PostgresResourcesTreeItemBase';
import { PostgresStoredProcedureTreeItem } from './PostgresStoredProcedureTreeItem';

export class PostgresStoredProceduresTreeItem extends PostgresResourcesTreeItemBase {
    public static contextValue: string = 'postgresStoredProcedures';
    public readonly contextValue: string = PostgresStoredProceduresTreeItem.contextValue;
    public readonly label: string = 'Stored Procedures';
    public readonly childTypeLabel: string = 'Stored Procedure';
    public suppressMaskLabel = true;

    constructor(parent: PostgresDatabaseTreeItem, clientConfig: ClientConfig) {
        super(parent);
        this.clientConfig = clientConfig;
    }

    public get iconPath(): TreeItemIconPath {
        return new ThemeIcon('server-process');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<PostgresStoredProcedureTreeItem[]> {
        const rows: IPostgresProceduresQueryRow[] = await getPostgresProcedureQueryRows(this);
        return rows.map((row) => new PostgresStoredProcedureTreeItem(this, row, this.isDuplicateResource(row.name)));
    }

    public isAncestorOfImpl(contextValue: string): boolean {
        return contextValue === PostgresStoredProcedureTreeItem.contextValue;
    }
}
