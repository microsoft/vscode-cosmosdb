/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getControlPlane } from '../../cosmosdb/controlPlane';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type CosmosDBTriggersModel } from './models/CosmosDBTriggersModel';
import { type TriggerResource } from './models/CosmosDBTypes';

export abstract class CosmosDBTriggersResourceItem
    implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.triggers';

    protected constructor(
        public readonly model: CosmosDBTriggersModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}/triggers`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    public async getChildren(): Promise<TreeElement[]> {
        const controlPlane = getControlPlane(this.model.accountInfo);
        const triggers = await controlPlane.listTriggers(this.model.database.id, this.model.container.id);
        const sortedTriggers = triggers.sort((a, b) => a.id.localeCompare(b.id));

        return this.getChildrenImpl(sortedTriggers);
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('zap'),
            label: l10n.t('Triggers'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected abstract getChildrenImpl(triggers: TriggerResource[]): Promise<TreeElement[]>;
}
