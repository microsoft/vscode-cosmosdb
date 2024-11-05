/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type ContainerDefinition, type Resource } from '@azure/cosmos';
import { AzExtTreeItem, type IActionContext, type TreeItemIconPath } from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { localize } from '../../utils/localize';
import { openUrl } from '../../utils/openUrl';
import { type GraphCollectionTreeItem } from './GraphCollectionTreeItem';

const alternativeGraphVisualizationToolsDocLink = 'https://aka.ms/cosmosdb-graph-alternative-tools';

export class GraphTreeItem extends AzExtTreeItem {
    public static contextValue: string = 'cosmosDBGraphGraph';
    public readonly contextValue: string = GraphTreeItem.contextValue;
    public declare readonly parent: GraphCollectionTreeItem;
    public suppressMaskLabel = true;

    private readonly _collection: ContainerDefinition & Resource;

    constructor(parent: GraphCollectionTreeItem, collection: ContainerDefinition & Resource) {
        super(parent);
        this.commandId = 'cosmosDB.openGraphExplorer';
        this._collection = collection;
    }

    public get id(): string {
        return this._collection.id;
    }

    public get label(): string {
        return 'Graph';
    }

    public get link(): string {
        return this._collection._self;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('files');
    }

    public async showExplorer(_context: IActionContext): Promise<void> {
        const message: string = localize('mustInstallGraph', 'Cosmos DB Graph extension has been retired.');
        const alternativeToolsOption = 'Alternative Tools';
        const result = await vscode.window.showErrorMessage(message, alternativeToolsOption);
        if (result === alternativeToolsOption) {
            await openUrl(alternativeGraphVisualizationToolsDocLink);
        }
    }
}
