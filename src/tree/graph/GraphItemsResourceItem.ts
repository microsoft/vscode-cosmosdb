/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { DocumentDBItemsResourceItem } from '../docdb/DocumentDBItemsResourceItem';
import { type DocumentDBItemsModel } from '../docdb/models/DocumentDBItemsModel';

export class GraphItemsResourceItem extends DocumentDBItemsResourceItem {
    constructor(model: DocumentDBItemsModel, experience: Experience) {
        super(model, experience);
    }

    async getChildren(): Promise<CosmosDBTreeElement[]> {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        return {
            id: this.id,
            contextValue: this.contextValue,
            iconPath: new vscode.ThemeIcon('file'),
            label: 'Graph',
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            command: {
                title: 'Open Graph Explorer',
                command: 'cosmosDB.openGraphExplorer',
            },
        };
    }

    protected getChildrenImpl(): Promise<CosmosDBTreeElement[]> {
        throw new Error('Method not implemented.');
    }
}
