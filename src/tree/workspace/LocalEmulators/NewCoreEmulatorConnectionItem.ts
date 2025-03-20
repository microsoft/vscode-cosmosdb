/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type CosmosDBTreeElement } from '../../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';

export class NewCoreEmulatorConnectionItem implements CosmosDBTreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.attachEmulator';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/attachEmulator`;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('New Emulator Connection…'),
            iconPath: new vscode.ThemeIcon('plus'),
            command: {
                command: 'cosmosDB.newEmulatorConnection',
                title: '',
                arguments: [this],
            },
        };
    }
}
