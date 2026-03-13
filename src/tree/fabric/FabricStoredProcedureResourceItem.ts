/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBStoredProcedureResourceItem } from '../cosmosdb/CosmosDBStoredProcedureResourceItem';
import { type FabricStoredProcedureModel } from './models/FabricStoredProcedureModel';

export abstract class FabricStoredProcedureResourceItem extends CosmosDBStoredProcedureResourceItem {
    declare public readonly model: FabricStoredProcedureModel;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        model: FabricStoredProcedureModel,
        experience: Experience,
    ) {
        super(model, experience);
    }
}
