/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';

export class NewMigrationItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.newMigration';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/newMigration`;
    }

    public getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('New Migration…'),
            iconPath: new vscode.ThemeIcon('plus'),
            command: {
                command: 'cosmosDB.migration.open',
                title: '',
                arguments: [this],
            },
        };
    }
}
