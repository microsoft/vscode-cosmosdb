/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBContainerResourceItem } from '../cosmosdb/CosmosDBContainerResourceItem';
import { type FabricContainerModel } from './models/FabricContainerModel';

export abstract class FabricContainerResourceItem extends CosmosDBContainerResourceItem {
    declare public readonly model: FabricContainerModel;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        model: FabricContainerModel,
        experience: Experience,
    ) {
        super(model, experience);
    }
}
