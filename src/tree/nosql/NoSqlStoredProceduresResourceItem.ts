/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { type TreeElement } from '../TreeElement';
import { CosmosDBStoredProceduresResourceItem } from '../cosmosdb/CosmosDBStoredProceduresResourceItem';
import { type CosmosDBStoredProceduresModel } from '../cosmosdb/models/CosmosDBStoredProceduresModel';
import { type StoredProcedureResource } from '../cosmosdb/models/CosmosDBTypes';
import { NoSqlStoredProcedureResourceItem } from './NoSqlStoredProcedureResourceItem';

export class NoSqlStoredProceduresResourceItem extends CosmosDBStoredProceduresResourceItem {
    constructor(model: CosmosDBStoredProceduresModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(storedProcedures: StoredProcedureResource[]): Promise<TreeElement[]> {
        return Promise.resolve(
            storedProcedures.map(
                (procedure) => new NoSqlStoredProcedureResourceItem({ ...this.model, procedure }, this.experience),
            ),
        );
    }
}
