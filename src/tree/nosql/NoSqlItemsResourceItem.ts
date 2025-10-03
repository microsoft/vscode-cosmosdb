/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { type TreeElement } from '../TreeElement';
import { CosmosDBItemsResourceItem } from '../cosmosdb/CosmosDBItemsResourceItem';
import { type CosmosDBItemsModel } from '../cosmosdb/models/CosmosDBItemsModel';
import { NoSqlItemResourceItem } from './NoSqlItemResourceItem';

export class NoSqlItemsResourceItem extends CosmosDBItemsResourceItem {
    constructor(model: CosmosDBItemsModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(items: ItemDefinition[]): Promise<TreeElement[]> {
        return Promise.resolve(
            items.map((item) => new NoSqlItemResourceItem({ ...this.model, item }, this.experience)),
        );
    }
}
