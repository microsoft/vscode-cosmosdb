/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBItemResourceItem } from '../cosmosdb/CosmosDBItemResourceItem';
import { type FabricItemModel } from './models/FabricItemModel';

export abstract class FabricItemResourceItem extends CosmosDBItemResourceItem {
    declare public readonly model: FabricItemModel;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        model: FabricItemModel,
        experience: Experience,
    ) {
        super(model, experience);
    }
}
