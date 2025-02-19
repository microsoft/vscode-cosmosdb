/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContextValue } from '@microsoft/vscode-azext-utils';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type TreeElementWithContextValue } from '../TreeElementWithContextValue';
import { type TreeElementWithExperience } from '../TreeElementWithExperience';
import { type DocumentDBContainerModel } from './models/DocumentDBContainerModel';

export abstract class DocumentDBContainerResourceItem
    implements CosmosDBTreeElement, TreeElementWithExperience, TreeElementWithContextValue
{
    public readonly id: string;
    public readonly contextValue: string = 'treeItem.container';

    protected constructor(
        public readonly model: DocumentDBContainerModel,
        public readonly experience: Experience,
    ) {
        this.id = `${model.accountInfo.id}/${model.database.id}/${model.container.id}`;
        this.contextValue = createContextValue([this.contextValue, `experience.${this.experience.api}`]);
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        const triggers = await this.getChildrenTriggersImpl();
        const storedProcedures = await this.getChildrenStoredProceduresImpl();
        const items = await this.getChildrenItemsImpl();

        return [items, storedProcedures, triggers].filter((r) => r !== undefined);
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('files'),
            label: this.model.container.id,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        };
    }

    protected abstract getChildrenTriggersImpl(): Promise<CosmosDBTreeElement | undefined>;
    protected abstract getChildrenStoredProceduresImpl(): Promise<CosmosDBTreeElement | undefined>;
    protected abstract getChildrenItemsImpl(): Promise<CosmosDBTreeElement | undefined>;
}
