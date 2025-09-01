/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ResourceBase } from '@microsoft/vscode-azureresources-api';
import * as l10n from '@vscode/l10n';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';

export class CosmosDBAccountUnsupportedResourceItem
    implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.unsupportedAccount';

    constructor(
        public readonly account: ResourceBase,
        public readonly experience: Experience,
        public readonly reason: string = l10n.t('Unsupported account type'),
    ) {
        this.id = account.id ?? uuid();
    }

    /**
     * Returns the children of the cluster.
     * @returns The children of the cluster.
     */
    getChildren(): Promise<TreeElement[]> {
        return Promise.resolve([]);
    }

    /**
     * Returns the tree item representation of the cluster.
     * @returns The TreeItem object.
     */
    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.account.name,
            description: `${this.reason} (${this.experience.shortName})`,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
        };
    }
}
