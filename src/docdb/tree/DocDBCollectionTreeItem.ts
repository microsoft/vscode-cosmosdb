/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type Container,
    type ContainerDefinition,
    type CosmosClient,
    type PartitionKeyDefinition,
    type Resource,
} from '@azure/cosmos';
import {
    AzExtParentTreeItem,
    DialogResponses,
    type AzExtTreeItem,
    type IActionContext,
    type TreeItemIconPath,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { type DocDBDatabaseTreeItem } from './DocDBDatabaseTreeItem';
import { DocDBDocumentTreeItem } from './DocDBDocumentTreeItem';
import { DocDBDocumentsTreeItem } from './DocDBDocumentsTreeItem';
import { DocDBStoredProcedureTreeItem } from './DocDBStoredProcedureTreeItem';
import { DocDBStoredProceduresTreeItem } from './DocDBStoredProceduresTreeItem';
import { DocDBTriggerTreeItem } from './DocDBTriggerTreeItem';
import { DocDBTriggersTreeItem } from './DocDBTriggersTreeItem';
import { type IDocDBTreeRoot } from './IDocDBTreeRoot';

/**
 * Represents a DocumentDB collection
 */
export class DocDBCollectionTreeItem extends AzExtParentTreeItem {
    public static contextValue: string = 'cosmosDBDocumentCollection';
    public readonly contextValue: string = DocDBCollectionTreeItem.contextValue;
    public declare readonly parent: DocDBDatabaseTreeItem;

    public readonly documentsTreeItem: DocDBDocumentsTreeItem;
    private readonly _storedProceduresTreeItem: DocDBStoredProceduresTreeItem;
    private readonly _triggersTreeItem: DocDBTriggersTreeItem;

    constructor(
        parent: DocDBDatabaseTreeItem,
        private _container: ContainerDefinition & Resource,
    ) {
        super(parent);
        this.documentsTreeItem = new DocDBDocumentsTreeItem(this);
        this._storedProceduresTreeItem = new DocDBStoredProceduresTreeItem(this);
        this._triggersTreeItem = new DocDBTriggersTreeItem(this);
    }

    public get root(): IDocDBTreeRoot {
        return this.parent.root;
    }

    public get id(): string {
        return this._container.id;
    }

    public get label(): string {
        return this._container.id;
    }

    public get iconPath(): TreeItemIconPath {
        return new vscode.ThemeIcon('files');
    }

    public get link(): string {
        return this._container._self;
    }

    public get partitionKey(): PartitionKeyDefinition | undefined {
        return this._container.partitionKey;
    }

    public async deleteTreeItemImpl(context: IActionContext): Promise<void> {
        const message: string = `Are you sure you want to delete collection '${this.label}' and its contents?`;
        await context.ui.showWarningMessage(
            message,
            { modal: true, stepName: 'deleteCollection' },
            DialogResponses.deleteResponse,
        );
        const client = this.root.getCosmosClient();
        await this.getContainerClient(client).delete();
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        return [this.documentsTreeItem, this._storedProceduresTreeItem, this._triggersTreeItem];
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public pickTreeItemImpl(expectedContextValues: (string | RegExp)[]): AzExtTreeItem | undefined {
        for (const expectedContextValue of expectedContextValues) {
            switch (expectedContextValue) {
                case DocDBDocumentsTreeItem.contextValue:
                case DocDBDocumentTreeItem.contextValue:
                    return this.documentsTreeItem;
                case DocDBStoredProceduresTreeItem.contextValue:
                case DocDBStoredProcedureTreeItem.contextValue:
                    return this._storedProceduresTreeItem;
                case DocDBTriggersTreeItem.contextValue:
                case DocDBTriggerTreeItem.contextValue:
                    return this._triggersTreeItem;
                default:
            }
        }

        return undefined;
    }

    public getContainerClient(client: CosmosClient): Container {
        return this.parent.getDatabaseClient(client).container(this.id);
    }
}
