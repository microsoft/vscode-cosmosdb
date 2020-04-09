/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { PostgresFunctionsTreeItem } from "./PostgresFunctionsTreeItem";

export class PostgresFunctionTreeItem extends AzureTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresFunction';
    public readonly contextValue: string = PostgresFunctionTreeItem.contextValue;
    public name: string;
    public definition: string;

    constructor(parent: PostgresFunctionsTreeItem, name: string, definition: string) {
        super(parent);
        this.name = name;
        this.definition = definition;
    }

    public get label(): string {
        return this.name;
    }
}
