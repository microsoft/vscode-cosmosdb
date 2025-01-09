/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type CosmosClient, type Resource } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { v4 as uuid } from 'uuid';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type DocumentDBDatabaseModel } from './models/DocumentDBDatabaseModel';

export abstract class DocumentDBDatabaseResourceItem implements CosmosDBTreeElement {
    public id: string;
    public contextValue: string = 'cosmosDB.item.database';

    protected constructor(
        protected readonly model: DocumentDBDatabaseModel,
        protected readonly experience: Experience,
    ) {
        this.id = uuid();
        this.contextValue = `${experience.api}.item.database`;
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;
            context.errorHandling.rethrow = true;

            const { endpoint, credentials, isEmulator } = this.model.accountInfo;
            const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
            const containers = await this.getContainers(cosmosClient);

            return await this.getChildrenImpl(containers);
        });

        return result ?? [];
    }

    getTreeItem(): TreeItem {
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
