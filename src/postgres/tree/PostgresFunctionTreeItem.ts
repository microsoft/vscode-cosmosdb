/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from "pg";
import { AzureTreeItem, ISubscriptionContext, TreeItemIconPath } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { IPostgresProceduresQueryRow } from "../IPostgresProceduresQueryRow";
import { PostgresFunctionsTreeItem } from "./PostgresFunctionsTreeItem";

export class PostgresFunctionTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresFunction';
    public readonly contextValue: string = PostgresFunctionTreeItem.contextValue;
    public readonly commandId: string = 'cosmosDB.openPostgresFunction';
    public readonly parent: PostgresFunctionsTreeItem;
    public readonly schema: string;
    public readonly name: string;
    public readonly id: string;
    public readonly isDuplicate: boolean;
    public definition: string;

    constructor(parent: PostgresFunctionsTreeItem, row: IPostgresProceduresQueryRow, isDuplicate: boolean) {
        super(parent);
        this.schema = row.schema;
        this.name = row.name;
        this.id = String(row.oid);
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
        return getThemeAgnosticIconPath('Collection.svg');
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const client = new Client(this.parent.clientConfig);
        await client.connect();
        await client.query(`DROP FUNCTION ${this.schema}.${this.name};`);
    }
}
