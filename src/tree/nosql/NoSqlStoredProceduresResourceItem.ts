/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Resource, type StoredProcedureDefinition } from '@azure/cosmos';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { DocumentDBStoredProceduresResourceItem } from '../docdb/DocumentDBStoredProceduresResourceItem';
import { type DocumentDBStoredProceduresModel } from '../docdb/models/DocumentDBStoredProceduresModel';
import { NoSqlStoredProcedureResourceItem } from './NoSqlStoredProcedureResourceItem';

export class NoSqlStoredProceduresResourceItem extends DocumentDBStoredProceduresResourceItem {
    constructor(model: DocumentDBStoredProceduresModel, experience: Experience) {
        super(model, experience);
    }

    protected getChildrenImpl(
        storedProcedures: (StoredProcedureDefinition & Resource)[],
    ): Promise<CosmosDBTreeElement[]> {
        return Promise.resolve(
            storedProcedures.map(
                (procedure) => new NoSqlStoredProcedureResourceItem({ ...this.model, procedure }, this.experience),
            ),
        );
    }
}
