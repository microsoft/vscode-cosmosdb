/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue, createGenericElement } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getControlPlane } from '../../cosmosdb/controlPlane';
import { countExperienceUsageForSurvey } from '../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../utils/surveyTypes';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type CosmosDBDatabaseModel } from './models/CosmosDBDatabaseModel';
import { type ContainerResource } from './models/CosmosDBTypes';

export abstract class CosmosDBDatabaseResourceItem
    implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.database';

    protected constructor(
        public readonly model: CosmosDBDatabaseModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    async getChildren(): Promise<TreeElement[]> {
        const controlPlane = getControlPlane(this.model.accountInfo);
        const containers = await controlPlane.listContainers(this.model.database.id);
        const sortedContainers = containers.sort((a, b) => a.id.localeCompare(b.id));

        if (containers.length === 0) {
            // no databases in there:
            return [
                createGenericElement({
                    contextValue: this.contextValue,
                    id: `${this.id}/no-containers`,
                    label: l10n.t('Create Container…'),
                    iconPath: new vscode.ThemeIcon('plus'),
                    commandId: 'cosmosDB.createContainer',
                    commandArgs: [this],
                }) as TreeElement,
            ];
        }
        countExperienceUsageForSurvey(ExperienceKind.NoSQL, UsageImpact.Low);
        return this.getChildrenImpl(sortedContainers);
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('database'),
            label: this.model.database.id,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected abstract getChildrenImpl(containers: ContainerResource[]): Promise<TreeElement[]>;
}
