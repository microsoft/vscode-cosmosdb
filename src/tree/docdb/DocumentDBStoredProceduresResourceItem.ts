/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient, type Resource, type StoredProcedureDefinition } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { v4 as uuid } from 'uuid';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type DocumentDBStoredProceduresModel } from './models/DocumentDBStoredProceduresModel';

export abstract class DocumentDBStoredProceduresResourceItem implements CosmosDBTreeElement {
    public id: string;
    public contextValue: string = 'cosmosDB.item.storedProcedures';

    protected constructor(
        protected readonly model: DocumentDBStoredProceduresModel,
        protected readonly experience: Experience,
    ) {
        this.id = uuid();
        this.contextValue = `${experience.api}.item.storedProcedures`;
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;
            context.errorHandling.rethrow = true;

            const { endpoint, credentials, isEmulator } = this.model.accountInfo;
            const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
            const storedProcedures = await this.getStoredProcedures(cosmosClient);

            return await this.getChildrenImpl(storedProcedures);
        });

        return result ?? [];
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('server-process'),
            label: 'StoredProcedures',
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected async getStoredProcedures(cosmosClient: CosmosClient): Promise<(StoredProcedureDefinition & Resource)[]> {
        const result = await cosmosClient
            .database(this.model.database.id)
            .container(this.model.container.id)
            .scripts.storedProcedures.readAll()
            .fetchAll();

        return result.resources;
    }

    protected abstract getChildrenImpl(
        storedProcedures: (StoredProcedureDefinition & Resource)[],
    ): Promise<CosmosDBTreeElement[]>;
}
