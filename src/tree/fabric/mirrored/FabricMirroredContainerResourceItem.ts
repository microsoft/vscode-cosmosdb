/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { type TreeElement } from '../../TreeElement';
import { FabricContainerResourceItem } from '../FabricContainerResourceItem';
import { type FabricContainerModel } from '../models/FabricContainerModel';
import { FabricMirroredItemsResourceItem } from './FabricMirroredItemsResourceItem';
import { FabricMirroredQueryEditorResourceItem } from './FabricMirroredQueryEditorResourceItem';

export class FabricMirroredContainerResourceItem extends FabricContainerResourceItem {
    public constructor(context: vscode.ExtensionContext, model: FabricContainerModel, experience: Experience) {
        super(context, model, experience);
    }

    async getChildren(): Promise<TreeElement[]> {
        const items = await super.getChildren();
        const queryEditor = new FabricMirroredQueryEditorResourceItem(this.context, { ...this.model }, this.experience);

        return [queryEditor, ...items];
    }

    protected getChildrenTriggersImpl(): Promise<TreeElement | undefined> {
        return Promise.resolve(undefined);
    }

    protected getChildrenStoredProceduresImpl(): Promise<TreeElement | undefined> {
        return Promise.resolve(undefined);
    }

    protected getChildrenItemsImpl(): Promise<TreeElement | undefined> {
        return Promise.resolve(new FabricMirroredItemsResourceItem(this.context, { ...this.model }, this.experience));
    }
}
