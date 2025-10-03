/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBStoredProcedureResourceItem } from '../cosmosdb/CosmosDBStoredProcedureResourceItem';
import { type CosmosDBStoredProcedureModel } from '../cosmosdb/models/CosmosDBStoredProcedureModel';

export class GraphStoredProcedureResourceItem extends CosmosDBStoredProcedureResourceItem {
    constructor(model: CosmosDBStoredProcedureModel, experience: Experience) {
        super(model, experience);
    }
}
