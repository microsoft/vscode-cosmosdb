/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { type TreeElement } from '../TreeElement';
import { CosmosDBContainerResourceItem } from '../cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBContainerModel } from '../cosmosdb/models/CosmosDBContainerModel';
import { GraphItemsResourceItem } from './GraphItemsResourceItem';
import { GraphStoredProceduresResourceItem } from './GraphStoredProceduresResourceItem';

export class GraphContainerResourceItem extends CosmosDBContainerResourceItem {
    constructor(model: CosmosDBContainerModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenTriggersImpl(): Promise<TreeElement | undefined> {
        return Promise.resolve(undefined);
    }

    protected getChildrenStoredProceduresImpl(): Promise<TreeElement | undefined> {
        return Promise.resolve(new GraphStoredProceduresResourceItem({ ...this.model }, this.experience));
    }

    protected getChildrenItemsImpl(): Promise<TreeElement | undefined> {
        return Promise.resolve(new GraphItemsResourceItem({ ...this.model }, this.experience));
    }
}
