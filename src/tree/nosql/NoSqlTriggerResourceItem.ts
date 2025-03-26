/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBTriggerResourceItem } from '../cosmosdb/CosmosDBTriggerResourceItem';
import { type CosmosDBTriggerModel } from '../cosmosdb/models/CosmosDBTriggerModel';

export class NoSqlTriggerResourceItem extends CosmosDBTriggerResourceItem {
    constructor(model: CosmosDBTriggerModel, experience: Experience) {
        super(model, experience);
    }
}
