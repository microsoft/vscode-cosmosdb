/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Experience } from '../../AzureDBExperiences';
import { DocumentDBStoredProcedureResourceItem } from '../docdb/DocumentDBStoredProcedureResourceItem';
import { type DocumentDBStoredProcedureModel } from '../docdb/models/DocumentDBStoredProcedureModel';

export class GraphStoredProcedureResourceItem extends DocumentDBStoredProcedureResourceItem {
    constructor(model: DocumentDBStoredProcedureModel, experience: Experience) {
        super(model, experience);
    }
}
