/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosClient, type FeedOptions, type ItemDefinition, type QueryIterator } from '@azure/cosmos';
import { createContextValue, createGenericElement, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getCosmosClient } from '../../docdb/getCosmosClient';
import { getBatchSizeSetting } from '../../utils/workspacUtils';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type DocumentDBItemsModel } from './models/DocumentDBItemsModel';

export abstract class DocumentDBItemsResourceItem
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.documents';

    protected hasMoreChildren: boolean = true;
    protected batchSize: number;

    protected constructor(
        public readonly model: DocumentDBItemsModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}/documents`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
        this.batchSize = getBatchSizeSetting();
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
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
                    label: 'Load more\u2026',
                    id: `${this.id}/loadMore`,
                    commandId: 'cosmosDB.loadMore',
                    commandArgs: [
                        this.id,
                        (context: IActionContext) => {
                            context.telemetry.properties.experience = this.experience.api;
                            context.telemetry.properties.parentContext = this.contextValue;

                            this.batchSize *= 2;
                        },
                    ],
                }) as CosmosDBTreeElement,
            );
        }

        return result;
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('files'),
            label: 'Documents',
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

    protected abstract getChildrenImpl(items: ItemDefinition[]): Promise<CosmosDBTreeElement[]>;
}
