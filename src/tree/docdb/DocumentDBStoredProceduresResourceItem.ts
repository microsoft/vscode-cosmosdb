/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient, type Resource, type StoredProcedureDefinition } from '@azure/cosmos';
import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type DocumentDBStoredProceduresModel } from './models/DocumentDBStoredProceduresModel';

export abstract class DocumentDBStoredProceduresResourceItem
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.storedProcedures';

    protected constructor(
        public readonly model: DocumentDBStoredProceduresModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}/storedProcedures`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const { endpoint, credentials, isEmulator } = this.model.accountInfo;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
        const storedProcedures = await this.getStoredProcedures(cosmosClient);

        return this.getChildrenImpl(storedProcedures);
    }

    getTreeItem(): vscode.TreeItem {
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
