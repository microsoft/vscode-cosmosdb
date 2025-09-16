/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { MongoClustersExperience, type Experience } from '../../../AzureDBExperiences';
import { type TreeElement } from '../../TreeElement';
import { type TreeElementWithExperience } from '../../TreeElementWithExperience';
import { SwitchToDocumentDbItem } from './SwitchToDocumentDbItem';

export class DocumentDbAccountsItem implements TreeElement, TreeElementWithExperience {
    public readonly id: string;
    public readonly experience: Experience;

    constructor() {
        this.id = 'vscode.documentdb.workspace.accounts';
        this.experience = MongoClustersExperience;
    }

    async getChildren(): Promise<TreeElement[]> {
        return [new SwitchToDocumentDbItem(this.id)];
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: 'vscode.cosmosdb.workspace.mongoclusters.accounts',
            label: l10n.t('MongoDB Accounts'),
            iconPath: new vscode.ThemeIcon('link'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
