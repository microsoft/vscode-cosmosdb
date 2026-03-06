/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { CosmosDBQueryEditorResourceItem } from '../cosmosdb/CosmosDBQueryEditorResourceItem';
import { type FabricQueryEditorModel } from './models/FabricQueryEditorModel';

export abstract class FabricQueryEditorResourceItem extends CosmosDBQueryEditorResourceItem {
    declare public readonly model: FabricQueryEditorModel;

    protected constructor(
        public readonly context: vscode.ExtensionContext,
        model: FabricQueryEditorModel,
        experience: Experience,
    ) {
        super(model, experience);
    }
}
