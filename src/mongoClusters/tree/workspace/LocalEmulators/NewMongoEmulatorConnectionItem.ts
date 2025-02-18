/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import vscode from 'vscode';
import { type CosmosDBTreeElement } from '../../../../tree/CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../../../../tree/TreeElementWithContextValue';

export class NewMongoEmulatorConnectionItem implements CosmosDBTreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.newConnection';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/newEmulatorConnection`;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: 'New Emulator Connection\u2026',
            iconPath: new vscode.ThemeIcon('plus'),
            command: {
                command: 'cosmosDB.newEmulatorConnection',
                title: '',
                arguments: [this],
            },
        };
    }
}
