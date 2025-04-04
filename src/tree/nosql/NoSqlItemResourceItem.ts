/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBItemResourceItem } from '../cosmosdb/CosmosDBItemResourceItem';
import { type CosmosDBItemModel } from '../cosmosdb/models/CosmosDBItemModel';

export class NoSqlItemResourceItem extends CosmosDBItemResourceItem {
    constructor(model: CosmosDBItemModel, experience: Experience) {
        super(model, experience);
    }
}
