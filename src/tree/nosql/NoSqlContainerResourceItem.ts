/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { type TreeElement } from '../TreeElement';
import { CosmosDBContainerResourceItem } from '../cosmosdb/CosmosDBContainerResourceItem';
import { type CosmosDBContainerModel } from '../cosmosdb/models/CosmosDBContainerModel';
import { NoSqlItemsResourceItem } from './NoSqlItemsResourceItem';
import { NoSqlStoredProceduresResourceItem } from './NoSqlStoredProceduresResourceItem';
import { NoSqlTriggersResourceItem } from './NoSqlTriggersResourceItem';

export class NoSqlContainerResourceItem extends CosmosDBContainerResourceItem {
    constructor(model: CosmosDBContainerModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenTriggersImpl(): Promise<TreeElement | undefined> {
        return Promise.resolve(new NoSqlTriggersResourceItem({ ...this.model }, this.experience));
    }

    protected getChildrenStoredProceduresImpl(): Promise<TreeElement | undefined> {
        return Promise.resolve(new NoSqlStoredProceduresResourceItem({ ...this.model }, this.experience));
    }

    protected getChildrenItemsImpl(): Promise<TreeElement | undefined> {
        return Promise.resolve(new NoSqlItemsResourceItem({ ...this.model }, this.experience));
    }
}
