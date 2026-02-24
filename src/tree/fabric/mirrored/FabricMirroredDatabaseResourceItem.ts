/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerResponse, type CosmosClient } from '@azure/cosmos';
import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { type ContainerResource } from '../../cosmosdb/models/CosmosDBTypes';
import { type TreeElement } from '../../TreeElement';
import { FabricDatabaseResourceItem } from '../FabricDatabaseResourceItem';
import { type FabricDatabaseModel } from '../models/FabricDatabaseModel';
import { FabricMirroredContainerResourceItem } from './FabricMirroredContainerResourceItem';

export class FabricMirroredDatabaseResourceItem extends FabricDatabaseResourceItem {
    public constructor(context: vscode.ExtensionContext, model: FabricDatabaseModel, experience: Experience) {
        super(context, model, experience);
    }

    protected async getContainers(cosmosClient: CosmosClient): Promise<ContainerResource[]> {
        if (this.model.artifactConnectionInfo.type === 'MIRRORED_KEY') {
            const containers: ContainerResource[] = [];
            const promises: Promise<ContainerResponse>[] = [];
            const databaseId = this.model.database.id;

            for (const collectionResourceId in this.model.artifactConnectionInfo.resourceTokens) {
                // Dictionary key looks like this: dbs/SampleDB/colls/Container
                const resourceIdObj = collectionResourceId.split('/');
                const tokenDatabaseId = resourceIdObj[1];
                const tokenCollectionId = resourceIdObj[3];

                if (tokenDatabaseId === databaseId) {
                    promises.push(cosmosClient.database(databaseId).container(tokenCollectionId).read());
                }
            }

            const responses = await Promise.all(promises);
            responses.forEach((response) => {
                containers.push(response.resource as ContainerResource);
            });

            return containers;
        }

        if (this.model.artifactConnectionInfo.type === 'MIRRORED_AAD') {
            const result = await cosmosClient.database(this.model.database.id).containers.readAll().fetchAll();
            return result.resources;
        }

        return [];
    }

    protected getChildrenImpl(containers: ContainerResource[]): Promise<TreeElement[]> {
        return Promise.resolve(
            containers.map(
                (container) =>
                    new FabricMirroredContainerResourceItem(
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
