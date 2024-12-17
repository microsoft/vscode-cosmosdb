/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createGenericElement } from '@microsoft/vscode-azext-utils';
import { ThemeIcon, TreeItemCollapsibleState, type TreeItem } from 'vscode';
import { type CosmosDbTreeElement } from '../CosmosDbTreeElement';
import { type IDatabaseInfo } from './IDatabaseInfo';
import { type MongoAccountModel } from './MongoAccountModel';

export class DatabaseItem implements CosmosDbTreeElement {
    id: string;

    constructor(
        readonly account: MongoAccountModel,
        readonly databaseInfo: IDatabaseInfo,
    ) {
        this.id = `${account.id}/${databaseInfo.name}`;
    }

    async getChildren(): Promise<CosmosDbTreeElement[]> {
        return [
            createGenericElement({
                contextValue: 'mongoClusters.item.no-collection',
                id: `${this.id}/no-databases`,
                label: 'Create collection...',
                commandId: 'command.mongoClusters.createCollection',
                commandArgs: [this],
            }) as CosmosDbTreeElement,
        ];
    }
    // const client: MongoClustersClient = await MongoClustersClient.getClient(this.mongoCluster.id);
    // const collections = await client.listCollections(this.databaseInfo.name);

    // if (collections.length === 0) {
    //     // no databases in there:
    //     return [
    //         createGenericElement({
    //             contextValue: 'mongoClusters.item.no-collection',
    //             id: `${this.id}/no-databases`,
    //             label: 'Create collection...',
    //             iconPath: new vscode.ThemeIcon('plus'),
    //             commandId: 'command.mongoClusters.createCollection',
    //             commandArgs: [this],
    //         }),
    //     ];
    // }

    // return collections.map((collection) => {
    //     return new CollectionItem(this.mongoCluster, this.databaseInfo, collection);
    // });

    getTreeItem(): TreeItem {
        return {
            id: this.id,
            contextValue: 'mongoClusters.item.database',
            label: this.databaseInfo.name,
            iconPath: new ThemeIcon('database'),
            collapsibleState: TreeItemCollapsibleState.Collapsed,
        };
    }
}
