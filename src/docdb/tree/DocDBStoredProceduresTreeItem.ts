/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DocumentClient, QueryIterator, CollectionMeta, FeedOptions, ProcedureMeta } from 'documentdb';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { IAzureTreeItem } from 'vscode-azureextensionui';
import { DocDBStoredProcedureTreeItem } from './DocDBStoredProcedureTreeItem';

/**
 * asdf
 * This class provides common logic for DocumentDB, Graph, and Table collections
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export class DocDBStoredProceduresTreeItem extends DocDBTreeItemBase<ProcedureMeta> {
    public static contextValue: string = "cosmosDBStoredProceduresGroup";
    public readonly contextValue: string = DocDBStoredProceduresTreeItem.contextValue;
    public readonly childTypeLabel: string = "Stored Procedure";

    constructor(documentEndpoint: string, masterKey: string, private _collection: CollectionMeta, isEmulator: boolean) {
        super(documentEndpoint, masterKey, isEmulator);
    }

    public initChild(resource: ProcedureMeta): IAzureTreeItem {
        return new DocDBStoredProcedureTreeItem(resource);
    }

    public get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'dark', 'stored procedures.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'light', 'stored procedures.svg')
        };
    }

    public get id(): string {
        return "$StoredProcedures";
    }

    public get label(): string {
        return "Stored Procedures";
    }

    public get link(): string {
        return this._collection._self;
    }

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<ProcedureMeta>> {
        return await client.readStoredProcedures(this.link, feedOptions);
    }

    /*asdf
    public async deleteTreeItem(_node: IAzureNode): Promise<void> {
        const message: string = `Are you sure you want to delete collection '${this.label}' and its contents?`;
        const result = await vscode.window.showWarningMessage(message, DialogBoxResponses.Yes, DialogBoxResponses.Cancel);
        if (result === DialogBoxResponses.Yes) {
            const client = this.getDocumentClient();
            await new Promise((resolve, reject) => {
                client.deleteCollection(this.link, function (err) {
                    err ? reject(err) : resolve();
                });
            });
        } else {
            throw new UserCancelledError();
        }
    }*/
}
