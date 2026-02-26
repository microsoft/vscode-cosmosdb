/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';

export interface MigrationModel {
    id: string;
    storageId: string;
    name: string;
    migrationPath: string;
}

export class MigrationItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.migration';

    constructor(public readonly model: MigrationModel) {
        this.id = model.id;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.model.name,
            iconPath: new vscode.ThemeIcon('arrow-swap'),
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                command: 'cosmosDB.migration.openExisting',
                title: '',
                arguments: [this],
            },
        };
    }
}
