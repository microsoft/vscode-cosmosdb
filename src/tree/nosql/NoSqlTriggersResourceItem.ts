/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { type TreeElement } from '../TreeElement';
import { CosmosDBTriggersResourceItem } from '../cosmosdb/CosmosDBTriggersResourceItem';
import { type CosmosDBTriggersModel } from '../cosmosdb/models/CosmosDBTriggersModel';
import { type TriggerResource } from '../cosmosdb/models/CosmosDBTypes';
import { NoSqlTriggerResourceItem } from './NoSqlTriggerResourceItem';

export class NoSqlTriggersResourceItem extends CosmosDBTriggersResourceItem {
    constructor(model: CosmosDBTriggersModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(triggers: TriggerResource[]): Promise<TreeElement[]> {
        return Promise.resolve(
            triggers.map((trigger) => new NoSqlTriggerResourceItem({ ...this.model, trigger }, this.experience)),
        );
    }
}
