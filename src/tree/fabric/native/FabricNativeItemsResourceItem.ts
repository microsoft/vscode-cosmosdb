/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ItemDefinition } from '@azure/cosmos';
import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { type TreeElement } from '../../TreeElement';
import { FabricItemsResourceItem } from '../FabricItemsResourceItem';
import { type FabricItemsModel } from '../models/FabricItemsModel';
import { FabricNativeItemResourceItem } from './FabricNativeItemResourceItem';

export class FabricNativeItemsResourceItem extends FabricItemsResourceItem {
    constructor(context: vscode.ExtensionContext, model: FabricItemsModel, experience: Experience) {
        super(context, model, experience);
    }

    protected getChildrenImpl(items: ItemDefinition[]): Promise<TreeElement[]> {
        return Promise.resolve(
            items.map(
                (item) => new FabricNativeItemResourceItem(this.context, { ...this.model, item }, this.experience),
            ),
        );
    }
}
