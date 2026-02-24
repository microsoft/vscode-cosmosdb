/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { FabricTriggerResourceItem } from '../FabricTriggerResourceItem';
import { type FabricTriggerModel } from '../models/FabricTriggerModel';

export class FabricNativeTriggerResourceItem extends FabricTriggerResourceItem {
    constructor(context: vscode.ExtensionContext, model: FabricTriggerModel, experience: Experience) {
        super(context, model, experience);
    }
}
