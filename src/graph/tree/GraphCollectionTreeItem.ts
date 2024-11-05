/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type Container, type ContainerDefinition, type CosmosClient, type Resource } from '@azure/cosmos';
import {
    AzExtParentTreeItem,
    DialogResponses,
    type AzExtTreeItem,
    type IActionContext,
    type TreeItemIconPath,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { DocDBStoredProceduresTreeItem } from '../../docdb/tree/DocDBStoredProceduresTreeItem';
import { DocDBStoredProcedureTreeItem } from '../../docdb/tree/DocDBStoredProcedureTreeItem';
import { type IDocDBTreeRoot } from '../../docdb/tree/IDocDBTreeRoot';
import { type GraphDatabaseTreeItem } from './GraphDatabaseTreeItem';
import { GraphTreeItem } from './GraphTreeItem';

export class GraphCollectionTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'cosmosDBGraph';
    public readonly contextValue: string = GraphCollectionTreeItem.contextValue;

    private readonly _graphTreeItem: GraphTreeItem;
    private readonly _storedProceduresTreeItem: DocDBStoredProceduresTreeItem;

    private readonly _collection: ContainerDefinition & Resource;

    constructor(parent: GraphDatabaseTreeItem, collection: ContainerDefinition & Resource) {
        super(parent);
        this._collection = collection;
        this._graphTreeItem = new GraphTreeItem(this, this._collection);
        this._storedProceduresTreeItem = new DocDBStoredProceduresTreeItem(this);
    }

    public get parentDatabase() {
        return this.parent as GraphDatabaseTreeItem;
    }

    public get root(): IDocDBTreeRoot {
        return this.parentDatabase.root;
    }

    public get id(): string {
        return this._collection.id;
    }

    public get label(): string {
        return this._collection.id;
    }

    public get link(): string {
        return this._collection._self;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('files');
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        return [this._graphTreeItem, this._storedProceduresTreeItem];
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const message: string = `Are you sure you want to delete graph '${this.label}' and its contents?`;
        await context.ui.showWarningMessage(
            message,
            { modal: true, stepName: 'deleteGraphCollection' },
            DialogResponses.deleteResponse,
        );
        const client = this.root.getCosmosClient();
        await this.getContainerClient(client).delete();
    }

    public pickTreeItemImpl(expectedContextValues: (string | RegExp)[]): AzExtTreeItem | undefined {
        for (const expectedContextValue of expectedContextValues) {
            switch (expectedContextValue) {
                case GraphTreeItem.contextValue:
                    return this._graphTreeItem;
                case DocDBStoredProceduresTreeItem.contextValue:
                case DocDBStoredProcedureTreeItem.contextValue:
                    return this._storedProceduresTreeItem;

                default:
            }
        }

        return undefined;
    }

    public getContainerClient(client: CosmosClient): Container {
        return this.parentDatabase.getDatabaseClient(client).container(this.id);
    }
}
