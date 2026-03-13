/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { FabricStoredProcedureResourceItem } from '../FabricStoredProcedureResourceItem';
import { type FabricStoredProcedureModel } from '../models/FabricStoredProcedureModel';

export class FabricMirroredStoredProcedureResourceItem extends FabricStoredProcedureResourceItem {
    constructor(context: vscode.ExtensionContext, model: FabricStoredProcedureModel, experience: Experience) {
        super(context, model, experience);
    }
}
