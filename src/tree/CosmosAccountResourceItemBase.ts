/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type TreeElementBase } from '@microsoft/vscode-azext-utils';
import { type TreeItem } from 'vscode';

import * as vscode from 'vscode';
import { getExperienceFromApi } from '../AzureDBExperiences';
import { type CosmosAccountModel } from './CosmosAccountModel';

export abstract class CosmosAccountResourceItemBase implements TreeElementBase {
    id: string;

    constructor(public cosmosAccount: CosmosAccountModel) {
        this.id = cosmosAccount.id ?? '';
    }

    /**
     * Returns the tree item representation of the cluster.
     * @returns The TreeItem object.
     */
    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: `${this.cosmosAccount.dbExperience}.item.account`,
            label: this.cosmosAccount.name,
            description: `(${getExperienceFromApi(this.cosmosAccount.dbExperience).shortName})`,
            //iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg'), // Uncomment if icon is available
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
