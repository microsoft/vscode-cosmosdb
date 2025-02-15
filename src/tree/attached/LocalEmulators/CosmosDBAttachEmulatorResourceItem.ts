/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import vscode from 'vscode';
import { type CosmosDBTreeElement } from '../../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';

export class CosmosDBAttachEmulatorResourceItem implements CosmosDBTreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.attachEmulator';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/attachEmulator`;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: 'Attach Emulator\u2026',
            iconPath: new vscode.ThemeIcon('plus'),
            command: {
                command: 'cosmosDB.attachEmulator',
                title: '',
                arguments: [this],
            },
        };
    }
}
