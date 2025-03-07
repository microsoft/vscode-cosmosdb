/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';

export class CosmosDBAttachAccountResourceItem implements CosmosDBTreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.attachAccount';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/attachAccount`;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: 'New Connection\u2026',
            iconPath: new vscode.ThemeIcon('plus'),
            command: {
                command: 'cosmosDB.newConnection',
                title: '',
                arguments: [this],
            },
        };
    }
}
