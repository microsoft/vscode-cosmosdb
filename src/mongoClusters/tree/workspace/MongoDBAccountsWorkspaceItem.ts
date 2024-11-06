/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createGenericElement, type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { ThemeIcon, TreeItemCollapsibleState, type ProviderResult, type TreeItem } from 'vscode';


export class MongoDBAccountsItem implements TreeElementBase {
    id: string;

    constructor(
    ) {
        this.id = `vscode.cosmosdb.workspace.mongoclusters.mongodbaccounts`;
    }

    getChildren(): ProviderResult<TreeElementBase[]> {
        return [
            createGenericElement({
                contextValue: this.id + '/newConnection',
                id: this.id + '/newConnection',
                label: 'New Connection...',
                iconPath: new ThemeIcon('plus'),
                commandId: 'mongoClusters.cmd.createCollection',
                commandArgs: [this],
            }),
        ]
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: 'vscode.cosmosdb.workspace.mongoclusters.mongodbaccounts',
            label: 'MongoDB Accounts',
            iconPath: new ThemeIcon('plug'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
