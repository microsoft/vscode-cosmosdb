/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type CosmosClient, type Resource } from '@azure/cosmos';
import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type DocumentDBDatabaseModel } from './models/DocumentDBDatabaseModel';

export abstract class DocumentDBDatabaseResourceItem
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.database';

    protected constructor(
        public readonly model: DocumentDBDatabaseModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        const { endpoint, credentials, isEmulator } = this.model.accountInfo;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
        const containers = await this.getContainers(cosmosClient);

        return this.getChildrenImpl(containers);
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('database'),
            label: this.model.database.id,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected async getContainers(cosmosClient: CosmosClient): Promise<(ContainerDefinition & Resource)[]> {
        const result = await cosmosClient.database(this.model.database.id).containers.readAll().fetchAll();
        return result.resources;
    }

    protected abstract getChildrenImpl(containers: (ContainerDefinition & Resource)[]): Promise<CosmosDBTreeElement[]>;
}
