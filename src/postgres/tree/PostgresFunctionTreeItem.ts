/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri } from 'vscode';
import { AzureTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { PostgresFunctionsTreeItem } from "./PostgresFunctionsTreeItem";

export interface IPostgresFunction {
    name: string;
    oid: number;
    description: string;
    definition: string;
}

export class PostgresFunctionTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresFunction';
    public readonly contextValue: string = PostgresFunctionTreeItem.contextValue;
    public readonly name: string;
    public readonly id: string;
    public readonly description: string;
    public definition: string;

    constructor(parent: PostgresFunctionsTreeItem, func: IPostgresFunction) {
        super(parent);
        this.name = func.name;
        this.id = String(func.oid);
        this.description = func.description;
        this.definition = func.definition;
    }

    public get label(): string {
        return this.name;
    }

    public get iconPath(): string | Uri | { light: string | Uri; dark: string | Uri } {
        return getThemeAgnosticIconPath('Collection.svg');
    }
}
