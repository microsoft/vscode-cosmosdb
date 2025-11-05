/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type CosmosClient, type Resource } from '@azure/cosmos';
import { createContextValue } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { withClaimsChallengeHandling } from '../../cosmosdb/withClaimsChallengeHandling';
import { countExperienceUsageForSurvey } from '../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../utils/surveyTypes';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type CosmosDBDatabaseModel } from './models/CosmosDBDatabaseModel';

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
        const containers = await withClaimsChallengeHandling(this.model.accountInfo, async (cosmosClient) =>
            this.getContainers(cosmosClient),
        );
        const sortedContainers = containers.sort((a, b) => a.id.localeCompare(b.id));

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

    protected async getContainers(cosmosClient: CosmosClient): Promise<(ContainerDefinition & Resource)[]> {
        const result = await cosmosClient.database(this.model.database.id).containers.readAll().fetchAll();
        return result.resources;
    }

    protected abstract getChildrenImpl(containers: (ContainerDefinition & Resource)[]): Promise<TreeElement[]>;
}
