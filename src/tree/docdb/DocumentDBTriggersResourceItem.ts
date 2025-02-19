/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient, type Resource, type TriggerDefinition } from '@azure/cosmos';
import { createContextValue } from '@microsoft/vscode-azext-utils';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type DocumentDBTriggersModel } from './models/DocumentDBTriggersModel';

export abstract class DocumentDBTriggersResourceItem
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.triggers';

    protected constructor(
        public readonly model: DocumentDBTriggersModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}/triggers`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const { endpoint, credentials, isEmulator } = this.model.accountInfo;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
        const triggers = await this.getTriggers(cosmosClient);

        return this.getChildrenImpl(triggers);
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('zap'),
            label: 'Triggers',
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected async getTriggers(cosmosClient: CosmosClient): Promise<(TriggerDefinition & Resource)[]> {
        const result = await cosmosClient
            .database(this.model.database.id)
            .container(this.model.container.id)
            .scripts.triggers.readAll()
            .fetchAll();
        return result.resources;
    }

    protected abstract getChildrenImpl(triggers: (TriggerDefinition & Resource)[]): Promise<CosmosDBTreeElement[]>;
}
