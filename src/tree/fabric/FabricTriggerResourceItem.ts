/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBTriggerResourceItem } from '../cosmosdb/CosmosDBTriggerResourceItem';
import { type FabricTriggerModel } from './models/FabricTriggerModel';

export abstract class FabricTriggerResourceItem extends CosmosDBTriggerResourceItem {
    declare public readonly model: FabricTriggerModel;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        model: FabricTriggerModel,
        experience: Experience,
    ) {
        super(model, experience);
    }
}
