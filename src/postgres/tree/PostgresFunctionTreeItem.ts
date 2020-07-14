/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem, ISubscriptionContext, TreeItemIconPath } from "vscode-azureextensionui";
import { getThemedIconPath } from "../../constants";
import { IPostgresProceduresQueryRow } from "../getPostgresProcedureQueryRows";
import { runPostgresQuery } from "../runPostgresQuery";
import { PostgresFunctionsTreeItem } from "./PostgresFunctionsTreeItem";

export class PostgresFunctionTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresFunction';
    public readonly contextValue: string = PostgresFunctionTreeItem.contextValue;
    public readonly commandId: string = 'postgreSQL.openFunction';
    public readonly parent: PostgresFunctionsTreeItem;
    public readonly schema: string;
    public readonly name: string;
    public readonly id: string;
    public readonly args: string;
    public readonly isDuplicate: boolean;
    public definition: string;

    constructor(parent: PostgresFunctionsTreeItem, row: IPostgresProceduresQueryRow, isDuplicate: boolean) {
        super(parent);
        this.schema = row.schema;
        this.name = row.name;
        this.id = String(row.oid);
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
        return getThemedIconPath('function.svg');
    }

    public async deleteTreeItemImpl(): Promise<void> {
        await runPostgresQuery(this.parent.clientConfig, `DROP FUNCTION ${this.schema}.${this.name}(${this.args});`);
    }
}
