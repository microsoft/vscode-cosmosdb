/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { ThemeIcon } from 'vscode';
import  { type IPostgresProceduresQueryRow } from '../getPostgresProcedureQueryRows';
import { runPostgresQuery } from '../runPostgresQuery';
import  { type PostgresStoredProceduresTreeItem } from './PostgresStoredProceduresTreeItem';

export class PostgresStoredProcedureTreeItem extends AzExtTreeItem {
    public static contextValue: string = 'postgresStoredProcedure';
    public readonly contextValue: string = PostgresStoredProcedureTreeItem.contextValue;
    public readonly parent: PostgresStoredProceduresTreeItem;
    public readonly schema: string;
    public readonly name: string;
    public readonly args: string;
    public readonly isDuplicate: boolean;
    public definition: string;

    constructor(parent: PostgresStoredProceduresTreeItem, row: IPostgresProceduresQueryRow, isDuplicate: boolean) {
        super(parent);
        this.schema = row.schema;
        this.name = row.name;
        this.id = String(row.oid);
        this.commandId = 'postgreSQL.openStoredProcedure';
        this.args = row.args;
        this.definition = row.definition;
        this.isDuplicate = isDuplicate;
    }

    public get label(): string {
        return this.name;
    }

    public get description(): string | undefined {
        return this.isDuplicate ? this.schema : undefined;
    }

    public get iconPath(): TreeItemIconPath {
        return new ThemeIcon('server-process');
    }

    public async deleteTreeItemImpl(): Promise<void> {
        await runPostgresQuery(this.parent.clientConfig, `DROP PROCEDURE ${this.schema}.${this.name}(${this.args});`);
    }
}
