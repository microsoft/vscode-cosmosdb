/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionMeta, CollectionPartitionKey } from 'documentdb';
import * as path from "path";
import * as vscode from 'vscode';
import { AzureParentTreeItem, AzureTreeItem, DialogResponses, UserCancelledError } from 'vscode-azureextensionui';
import { resourcesPath } from '../../constants';
import { DocDBDatabaseTreeItem } from './DocDBDatabaseTreeItem';
import { DocDBDocumentsTreeItem } from './DocDBDocumentsTreeItem';
import { DocDBDocumentTreeItem } from './DocDBDocumentTreeItem';
import { DocDBStoredProceduresTreeItem } from './DocDBStoredProceduresTreeItem';
import { DocDBStoredProcedureTreeItem } from './DocDBStoredProcedureTreeItem';
import { IDocDBTreeRoot } from './IDocDBTreeRoot';

/**
 * Represents a DocumentDB collection
 */
export class DocDBCollectionTreeItem extends AzureParentTreeItem<IDocDBTreeRoot> {
    public static contextValue: string = "cosmosDBDocumentCollection";
    public readonly contextValue: string = DocDBCollectionTreeItem.contextValue;
    public readonly documentsTreeItem: DocDBDocumentsTreeItem;

    private readonly _storedProceduresTreeItem: DocDBStoredProceduresTreeItem;

    constructor(parent: DocDBDatabaseTreeItem, private _collection: CollectionMeta) {
        super(parent);
        this.documentsTreeItem = new DocDBDocumentsTreeItem(this);
        this._storedProceduresTreeItem = new DocDBStoredProceduresTreeItem(this);
    }

    public get id(): string {
        return this._collection.id;
    }

    public get label(): string {
        return this._collection.id;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(resourcesPath, 'icons', 'theme-agnostic', 'Collection.svg'),
            dark: path.join(resourcesPath, 'icons', 'theme-agnostic', 'Collection.svg')
        };
    }

    public get link(): string {
        return this._collection._self;
    }

    public get partitionKey(): CollectionPartitionKey | undefined {
        return this._collection.partitionKey;
    }

    public async deleteTreeItemImpl(): Promise<void> {
        const message: string = `Are you sure you want to delete collection '${this.label}' and its contents?`;
        const result = await vscode.window.showWarningMessage(message, { modal: true }, DialogResponses.deleteResponse, DialogResponses.cancel);
        if (result === DialogResponses.deleteResponse) {
            const client = this.root.getDocumentClient();
            await new Promise((resolve, reject) => {
                client.deleteCollection(this.link, err => err ? reject(err) : resolve());
            });
        } else {
            throw new UserCancelledError();
        }
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem<IDocDBTreeRoot>[]> {
        return [this.documentsTreeItem, this._storedProceduresTreeItem];
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public pickTreeItemImpl(expectedContextValues: (string | RegExp)[]): AzureTreeItem<IDocDBTreeRoot> | undefined {
        for (const expectedContextValue of expectedContextValues) {
            switch (expectedContextValue) {
                case DocDBDocumentsTreeItem.contextValue:
                case DocDBDocumentTreeItem.contextValue:
                    return this.documentsTreeItem;
                case DocDBStoredProceduresTreeItem.contextValue:
                case DocDBStoredProcedureTreeItem.contextValue:
                    return this._storedProceduresTreeItem;
                default:
            }
        }

        return undefined;
    }
}
