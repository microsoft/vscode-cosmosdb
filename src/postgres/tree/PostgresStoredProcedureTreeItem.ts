/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem, ISubscriptionContext, TreeItemIconPath } from "vscode-azureextensionui";
import { getThemedIconPath } from "../../constants";
import { IPostgresProceduresQueryRow } from "../getPostgresProcedureQueryRows";
import { PostgresStoredProceduresTreeItem } from "./PostgresStoredProceduresTreeItem";

export class PostgresStoredProcedureTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresStoredProcedure';
    public readonly contextValue: string = PostgresStoredProcedureTreeItem.contextValue;
    public readonly parent: PostgresStoredProceduresTreeItem;
    public readonly schema: string;
    public readonly name: string;
    public readonly id: string;
    public readonly args: string;
    public readonly isDuplicate: boolean;
    public definition: string;

    constructor(parent: PostgresStoredProceduresTreeItem, row: IPostgresProceduresQueryRow, isDuplicate: boolean) {
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
        return getThemedIconPath('Process_16x.svg');
    }
}
