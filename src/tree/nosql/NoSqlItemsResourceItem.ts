/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition, type Resource } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { DocumentDBItemsResourceItem } from '../docdb/DocumentDBItemsResourceItem';
import { type DocumentDBItemsModel } from '../docdb/models/DocumentDBItemsModel';
import { NoSqlItemResourceItem } from './NoSqlItemResourceItem';

export class NoSqlItemsResourceItem extends DocumentDBItemsResourceItem {
    constructor(model: DocumentDBItemsModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(items: (ItemDefinition & Resource)[]): Promise<CosmosDBTreeElement[]> {
        return Promise.resolve(
            items.map((item) => new NoSqlItemResourceItem({ ...this.model, item }, this.experience)),
        );
    }
}
