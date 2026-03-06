/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBDatabaseResourceItem } from '../cosmosdb/CosmosDBDatabaseResourceItem';
import { type FabricDatabaseModel } from './models/FabricDatabaseModel';

export abstract class FabricDatabaseResourceItem extends CosmosDBDatabaseResourceItem {
    declare public readonly model: FabricDatabaseModel;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        model: FabricDatabaseModel,
        experience: Experience,
    ) {
        super(model, experience);
    }
}
