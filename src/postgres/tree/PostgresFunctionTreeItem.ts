/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem, ISubscriptionContext, TreeItemIconPath } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { IPostgresFunctionsQueryRow, PostgresFunctionsTreeItem } from "./PostgresFunctionsTreeItem";

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

    constructor(parent: PostgresFunctionsTreeItem, row: IPostgresFunctionsQueryRow, isDuplicate: boolean) {
        super(parent);
        this.schema = row.schema;
        this.name = row.name;
        this.id = `${row.schema}.${row.name}`;
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
}
