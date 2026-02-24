/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type vscode from 'vscode';
import { type Experience } from '../../../AzureDBExperiences';
import { type TriggerResource } from '../../cosmosdb/models/CosmosDBTypes';
import { type TreeElement } from '../../TreeElement';
import { FabricTriggersResourceItem } from '../FabricTriggersResourceItem';
import { type FabricTriggersModel } from '../models/FabricTriggersModel';
import { FabricNativeTriggerResourceItem } from './FabricNativeTriggerResourceItem';

export class FabricNativeTriggersResourceItem extends FabricTriggersResourceItem {
    constructor(context: vscode.ExtensionContext, model: FabricTriggersModel, experience: Experience) {
        super(context, model, experience);
    }

    protected getChildrenImpl(triggers: TriggerResource[]): Promise<TreeElement[]> {
        return Promise.resolve(
            triggers.map(
                (trigger) =>
                    new FabricNativeTriggerResourceItem(this.context, { ...this.model, trigger }, this.experience),
            ),
        );
    }
}
