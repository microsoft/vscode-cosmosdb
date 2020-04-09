/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Uri } from 'vscode';
import { AzureParentTreeItem, ISubscriptionContext } from "vscode-azureextensionui";
import { getThemeAgnosticIconPath } from "../../constants";
import { PostgresDatabaseTreeItem } from './PostgresDatabaseTreeItem';
import { IPostgresFunction, PostgresFunctionTreeItem } from "./PostgresFunctionTreeItem";

export class PostgresFunctionsTreeItem extends AzureParentTreeItem<ISubscriptionContext> {
    public static contextValue: string = 'postgresFunctions';
    public readonly contextValue: string = PostgresFunctionsTreeItem.contextValue;
    public readonly label: string = 'Functions';
    public readonly childTypeLabel: string = 'Function';

    private _functions: IPostgresFunction[];

    constructor(parent: PostgresDatabaseTreeItem, functions: IPostgresFunction[]) {
        super(parent);
        this._functions = functions;
    }

    public get iconPath(): string | Uri | { light: string | Uri; dark: string | Uri } {
        return getThemeAgnosticIconPath('Collection.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(): Promise<PostgresFunctionTreeItem[]> {
        return this._functions.map(func => new PostgresFunctionTreeItem(this, func));
    }
}
