/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { v4 as uuid } from 'uuid';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type DocumentDBTriggerModel } from './models/DocumentDBTriggerModel';

export abstract class DocumentDBTriggerResourceItem implements CosmosDBTreeElement {
    public id: string;
    public contextValue: string = 'cosmosDB.item.trigger';

    protected constructor(
        protected readonly model: DocumentDBTriggerModel,
        protected readonly experience: Experience,
    ) {
        this.id = uuid();
        this.contextValue = `${experience.api}.item.trigger`;
    }

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('zap'),
            label: this.model.trigger.id,
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                title: 'Open Trigger',
                command: 'cosmosDB.openTrigger',
            },
        };
    }
}
