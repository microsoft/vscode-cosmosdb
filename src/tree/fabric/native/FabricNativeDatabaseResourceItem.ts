/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient } from '@azure/cosmos';
import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { type ContainerResource } from '../../cosmosdb/models/CosmosDBTypes';
import { type TreeElement } from '../../TreeElement';
import { FabricDatabaseResourceItem } from '../FabricDatabaseResourceItem';
import { type FabricDatabaseModel } from '../models/FabricDatabaseModel';
import { FabricNativeContainerResourceItem } from './FabricNativeContainerResourceItem';

export class FabricNativeDatabaseResourceItem extends FabricDatabaseResourceItem {
    public constructor(context: vscode.ExtensionContext, model: FabricDatabaseModel, experience: Experience) {
        super(context, model, experience);
    }

    protected async getContainers(cosmosClient: CosmosClient): Promise<ContainerResource[]> {
        const result = await cosmosClient.database(this.model.database.id).containers.readAll().fetchAll();
        return result.resources;
    }

    protected getChildrenImpl(containers: ContainerResource[]): Promise<TreeElement[]> {
        return Promise.resolve(
            containers.map(
                (container) =>
                    new FabricNativeContainerResourceItem(
                        this.context,
                        {
                            ...this.model,
                            container,
                        },
                        this.experience,
                    ),
            ),
        );
    }
}
