/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { v4 as uuid } from 'uuid';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type DocumentDBContainerModel } from './models/DocumentDBContainerModel';

export abstract class DocumentDBContainerResourceItem implements CosmosDBTreeElement {
    public id: string;
    public contextValue: string = 'cosmosDB.item.container';

    protected constructor(
        protected readonly model: DocumentDBContainerModel,
        protected readonly experience: Experience,
    ) {
        this.id = uuid();
        this.contextValue = `${experience.api}.item.container`;
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling('getChildren', async (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;

            const triggers = await this.getChildrenTriggersImpl();
            const storedProcedures = await this.getChildrenStoredProceduresImpl();
            const items = await this.getChildrenItemsImpl();

            return [items, storedProcedures, triggers].filter((r) => r !== undefined);
        });

        return result ?? [];
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
