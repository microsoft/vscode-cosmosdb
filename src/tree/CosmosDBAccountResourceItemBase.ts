/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import { type ResourceBase } from '@microsoft/vscode-azureresources-api';
import { v4 as uuid } from 'uuid';
import * as vscode from 'vscode';
import { type TreeItem } from 'vscode';
import { type Experience } from '../AzureDBExperiences';
import { type CosmosDBTreeElement } from './CosmosDBTreeElement';
import { type TreeElementWithContextValue } from './TreeElementWithContextValue';
import { type TreeElementWithExperience } from './TreeElementWithExperience';

export abstract class CosmosDBAccountResourceItemBase
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.account';

    protected constructor(
        public readonly account: ResourceBase,
        public readonly experience: Experience,
    ) {
        this.id = account.id ?? uuid();
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
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
        return {
            id: this.id,
            contextValue: this.contextValue,
            label: this.account.name,
            description: `(${this.experience.shortName})`,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    abstract getConnectionString(): Promise<string | undefined>;
}
