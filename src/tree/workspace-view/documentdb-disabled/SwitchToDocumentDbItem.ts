/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithContextValue } from '../../TreeElementWithContextValue';

export class SwitchToDocumentDbItem implements TreeElement, TreeElementWithContextValue {
    public readonly id: string;
    public readonly contextValue: string = 'treeItem_activateDocumentDbView';

    constructor(public readonly parentId: string) {
        this.id = `${parentId}/activateDocumentDbView`;
    }

    public getTreeItem(): vscode.TreeItem {
        const tooltip = new vscode.MarkdownString(
            l10n.t(
                'The "MongoDB Connections" functionality has moved to the "DocumentDB for VS Code" extension.\n\n' +
                    'If you had connections saved here in the past, they have been migrated to the new "Connections View".\n\n' +
                    'Click to install the new "DocumentDB for VS Code" extension.',
            ),
        );

        return {
            id: this.id,
            contextValue: this.contextValue,
            label: l10n.t('Install "DocumentDB for VS Code" Extension…'),
            description: l10n.t('Connections have moved'),
            tooltip,
            iconPath: new vscode.ThemeIcon('extensions'),
            command: {
                command: 'extension.open',
                title: '',
                arguments: ['ms-azuretools.vscode-documentdb'],
            },
        };
    }
}
