/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBStoredProceduresResourceItem } from '../cosmosdb/CosmosDBStoredProceduresResourceItem';
import { type FabricStoredProceduresModel } from './models/FabricStoredProceduresModel';

export abstract class FabricStoredProceduresResourceItem extends CosmosDBStoredProceduresResourceItem {
    declare public readonly model: FabricStoredProceduresModel;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        model: FabricStoredProceduresModel,
        experience: Experience,
    ) {
        super(model, experience);
    }
}
