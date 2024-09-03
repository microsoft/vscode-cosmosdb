/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import  { type TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import { AzExtTreeItem } from '@microsoft/vscode-azext-utils';
import { ThemeIcon } from 'vscode';
import  { type IPostgresProceduresQueryRow } from '../getPostgresProcedureQueryRows';
import { runPostgresQuery, wrapArgInQuotes } from '../runPostgresQuery';
import  { type PostgresFunctionsTreeItem } from './PostgresFunctionsTreeItem';

export class PostgresFunctionTreeItem extends AzExtTreeItem {
    public static contextValue: string = 'postgresFunction';
    public readonly contextValue: string = PostgresFunctionTreeItem.contextValue;
    public readonly parent: PostgresFunctionsTreeItem;
    public readonly schema: string;
    public readonly name: string;
    public readonly args: string;
    public readonly isDuplicate: boolean;
    public definition: string;

    constructor(parent: PostgresFunctionsTreeItem, row: IPostgresProceduresQueryRow, isDuplicate: boolean) {
        super(parent);
        this.schema = row.schema;
        this.name = row.name;
        this.id = String(row.oid);
        this.commandId = 'postgreSQL.openFunction';
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
        return new ThemeIcon('symbol-function');
    }

    public async deleteTreeItemImpl(): Promise<void> {
        await runPostgresQuery(
            this.parent.clientConfig,
            `DROP FUNCTION ${this.schema}.${wrapArgInQuotes(this.name)}(${this.args});`,
        );
    }
}
