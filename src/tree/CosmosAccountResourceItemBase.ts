/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type TreeItem } from 'vscode';
import { type CosmosAccountModel } from './CosmosAccountModel';
import { type CosmosDbTreeElement } from './CosmosDbTreeElement';

export abstract class CosmosAccountResourceItemBase implements CosmosDbTreeElement {
    public id: string;
    public readonly account: CosmosAccountModel;

    protected constructor(cosmosAccount: CosmosAccountModel) {
        this.id = cosmosAccount.id ?? '';
        this.account = cosmosAccount;
    }

    /**
     * Returns the tree item representation of the cluster.
     * @returns The TreeItem object.
     */
    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: `${this.account.dbExperience.api}.item.account`,
            label: this.account.name,
            description: `(${this.account.dbExperience.shortName})`,
            //iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg'), // Uncomment if icon is available
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }
}
