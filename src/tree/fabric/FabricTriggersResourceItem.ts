/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBTriggersResourceItem } from '../cosmosdb/CosmosDBTriggersResourceItem';
import { type FabricTriggersModel } from './models/FabricTriggersModel';

export abstract class FabricTriggersResourceItem extends CosmosDBTriggersResourceItem {
    declare public readonly model: FabricTriggersModel;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        model: FabricTriggersModel,
        experience: Experience,
    ) {
        super(model, experience);
    }
}
