/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient, type Resource, type TriggerDefinition } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { v4 as uuid } from 'uuid';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type DocumentDBTriggersModel } from './models/DocumentDBTriggersModel';

export abstract class DocumentDBTriggersResourceItem implements CosmosDBTreeElement {
    public id: string;
    public contextValue: string = 'cosmosDB.item.triggers';

    protected constructor(
        protected readonly model: DocumentDBTriggersModel,
        protected readonly experience: Experience,
    ) {
        this.id = uuid();
        this.contextValue = `${experience.api}.item.triggers`;
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;

            const { endpoint, credentials, isEmulator } = this.model.accountInfo;
            const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
            const triggers = await this.getTriggers(cosmosClient);

            return await this.getChildrenImpl(triggers);
        });

        return result ?? [];
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
