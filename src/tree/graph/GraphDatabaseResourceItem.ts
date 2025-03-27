/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type Resource } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBDatabaseResourceItem } from '../cosmosdb/CosmosDBDatabaseResourceItem';
import { type CosmosDBDatabaseModel } from '../cosmosdb/models/CosmosDBDatabaseModel';
import { GraphContainerResourceItem } from './GraphContainerResourceItem';

export class GraphDatabaseResourceItem extends CosmosDBDatabaseResourceItem {
    constructor(model: CosmosDBDatabaseModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(containers: (ContainerDefinition & Resource)[]): Promise<GraphContainerResourceItem[]> {
        return Promise.resolve(
            containers.map(
                (container) => new GraphContainerResourceItem({ ...this.model, container }, this.experience),
            ),
        );
    }
}
