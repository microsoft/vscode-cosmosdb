/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient, type FeedOptions, type ItemDefinition, type QueryIterator } from '@azure/cosmos';
import { createContextValue, createGenericElement, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../cosmosdb/getCosmosClient';
import { countExperienceUsageForSurvey } from '../../utils/survey';
import { ExperienceKind, UsageImpact } from '../../utils/surveyTypes';
import { getBatchSizeSetting } from '../../utils/workspacUtils';
import { type TreeElement } from '../TreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type CosmosDBItemsModel } from './models/CosmosDBItemsModel';

export abstract class CosmosDBItemsResourceItem
    implements TreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.documents';

    protected hasMoreChildren: boolean = true;
    protected batchSize: number;

    protected constructor(
        public readonly model: CosmosDBItemsModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}/documents`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
        this.batchSize = getBatchSizeSetting();
    }

    public async getChildren(): Promise<TreeElement[]> {
        const { endpoint, credentials, isEmulator } = this.model.accountInfo;
        const cosmosClient = getCosmosClient(endpoint, credentials, isEmulator);
        const iterator = this.getIterator(cosmosClient, { maxItemCount: this.batchSize });
        const items = await this.getItems(iterator);

        const result = await this.getChildrenImpl(items);

        if (this.hasMoreChildren) {
            result.push(
                createGenericElement({
                    contextValue: this.contextValue,
                    iconPath: new vscode.ThemeIcon('refresh'),
                    label: l10n.t('Load more…'),
                    id: `${this.id}/loadMore`,
                    commandId: 'cosmosDB.loadMore',
                    commandArgs: [
                        this.id,
                        (context: IActionContext) => {
                            context.telemetry.properties.experience = this.experience.api;
                            context.telemetry.properties.parentContext = this.contextValue;

                            this.batchSize *= 2;
                            countExperienceUsageForSurvey(ExperienceKind.NoSQL, UsageImpact.Medium);
                        },
                    ],
                }) as TreeElement,
            );
        }

        countExperienceUsageForSurvey(ExperienceKind.NoSQL, UsageImpact.Low);
        return result;
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('files'),
            label: l10n.t('Documents'),
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected getIterator(cosmosClient: CosmosClient, feedOptions: FeedOptions): QueryIterator<ItemDefinition> {
        return cosmosClient
            .database(this.model.database.id)
            .container(this.model.container.id)
            .items.readAll(feedOptions);
    }

    protected async getItems(iterator: QueryIterator<ItemDefinition>): Promise<ItemDefinition[]> {
        const result = await iterator.fetchNext();
        const items = result.resources;
        this.hasMoreChildren = result.hasMoreResults;

        return items;
    }

    protected abstract getChildrenImpl(items: ItemDefinition[]): Promise<TreeElement[]>;
}
