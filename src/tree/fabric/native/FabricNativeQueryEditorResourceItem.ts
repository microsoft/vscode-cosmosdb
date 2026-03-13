/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { type TreeElement } from '../../TreeElement';
import { FabricQueryEditorResourceItem } from '../FabricQueryEditorResourceItem';
import { type FabricQueryEditorModel } from '../models/FabricQueryEditorModel';

export class FabricNativeQueryEditorResourceItem extends FabricQueryEditorResourceItem {
    public constructor(context: vscode.ExtensionContext, model: FabricQueryEditorModel, experience: Experience) {
        super(context, model, experience);
    }

    protected getChildrenImpl(): Promise<TreeElement[]> {
        return Promise.resolve([]);
    }
}
