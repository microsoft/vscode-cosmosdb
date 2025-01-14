/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type TreeItem } from 'vscode';
import { getExperienceLabel, tryGetExperience } from '../AzureDBExperiences';
import { type CosmosAccountModel } from './CosmosAccountModel';
import { type CosmosDBTreeElement } from './CosmosDBTreeElement';

export abstract class CosmosAccountResourceItemBase implements CosmosDBTreeElement {
    public id: string;
    public contextValue: string = 'cosmosDB.item.account';

    protected constructor(public readonly account: CosmosAccountModel) {
        this.id = account.id ?? '';
    }

    /**
     * Returns the children of the cluster.
     * @returns The children of the cluster.
     */
    getChildren(): Promise<CosmosDBTreeElement[]> {
        return Promise.resolve([]);
    }

    /**
     * Returns the tree item representation of the cluster.
     * @returns The TreeItem object.
     */
    getTreeItem(): TreeItem {
        const experience = tryGetExperience(this.account);
        if (!experience) {
            const accountKindLabel = getExperienceLabel(this.account);
            const label: string = this.account.name + (accountKindLabel ? ` (${accountKindLabel})` : ``);
            return {
                id: this.id,
                contextValue: 'cosmosDB.item.account',
                label: label,
                collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
            };
        }
        return {
            id: this.id,
            contextValue: `${experience.api}.item.account`,
            label: this.account.name,
            description: `(${experience.shortName})`,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
