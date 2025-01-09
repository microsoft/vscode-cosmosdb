/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { DocumentDBItemsResourceItem } from '../docdb/DocumentDBItemsResourceItem';
import { type DocumentDBItemsModel } from '../docdb/models/DocumentDBItemsModel';
import { GraphItemResourceItem } from './GraphItemResourceItem';

export class GraphItemsResourceItem extends DocumentDBItemsResourceItem {
    constructor(model: DocumentDBItemsModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(items: ItemDefinition[]): Promise<CosmosDBTreeElement[]> {
        return Promise.resolve(
            items.map((item) => new GraphItemResourceItem({ ...this.model, item }, this.experience)),
        );
    }
}
