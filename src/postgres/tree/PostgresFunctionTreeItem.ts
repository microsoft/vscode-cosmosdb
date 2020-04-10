/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem, ISubscriptionContext, TreeItemIconPath } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { PostgresFunctionsTreeItem } from "./PostgresFunctionsTreeItem";

export class PostgresFunctionTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresFunction';
    public readonly contextValue: string = PostgresFunctionTreeItem.contextValue;
    public readonly schema: string;
    public readonly name: string;
    public readonly id: string;
    public readonly isDuplicate: boolean;
    public definition: string;

    constructor(parent: PostgresFunctionsTreeItem, schema: string, name: string, oid: number, definition: string, isDuplicate: boolean) {
        super(parent);
        this.schema = schema;
        this.name = name;
        this.id = String(oid);
        this.definition = definition;
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
