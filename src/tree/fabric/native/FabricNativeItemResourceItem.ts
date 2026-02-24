/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { FabricItemResourceItem } from '../FabricItemResourceItem';
import { type FabricItemModel } from '../models/FabricItemModel';

export class FabricNativeItemResourceItem extends FabricItemResourceItem {
    constructor(context: vscode.ExtensionContext, model: FabricItemModel, experience: Experience) {
        super(context, model, experience);
    }
}
