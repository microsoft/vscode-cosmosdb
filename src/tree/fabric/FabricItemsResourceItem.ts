/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBItemsResourceItem } from '../cosmosdb/CosmosDBItemsResourceItem';
import { type FabricItemsModel } from './models/FabricItemsModel';

export abstract class FabricItemsResourceItem extends CosmosDBItemsResourceItem {
    declare public readonly model: FabricItemsModel;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        model: FabricItemsModel,
        experience: Experience,
    ) {
        super(model, experience);
    }
}
