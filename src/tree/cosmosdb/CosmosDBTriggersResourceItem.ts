/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { type TreeElement } from '../TreeElement';
import { TreeElementWithContextValue } from '../TreeElementWithContextValue';
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
        this.contextValue = TreeElementWithContextValue.createContextValue([
            this.contextValue,
            `experience.${this.experience.api}`,
        ]);
    }

    public async getChildren(): Promise<TreeElement[]> {
        const triggers = await withClaimsChallengeHandling(this.model.accountInfo, async (client) => {
            const result = await client
                .database(this.model.database.id)
                .container(this.model.container.id)
                .scripts.triggers.readAll()
                .fetchAll();
            return result.resources;
        });
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
