/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from "vscode";
import { DocumentClient, QueryIterator, FeedOptions, ProcedureMeta } from 'documentdb';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import { IAzureTreeItem, UserCancelledError, IAzureNode } from 'vscode-azureextensionui';
import { DocDBStoredProcedureTreeItem } from './DocDBStoredProcedureTreeItem';
import { defaultStoredProcedure } from '../../constants';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';

/**
 * This class represents the DocumentDB "Stored Procedures" node in the tree
 */
export class DocDBStoredProceduresTreeItem extends DocDBTreeItemBase<ProcedureMeta> {
    public static contextValue: string = "cosmosDBStoredProceduresGroup";
    public readonly contextValue: string = DocDBStoredProceduresTreeItem.contextValue;
    public readonly childTypeLabel: string = "Stored Procedure";

    constructor(endpoint: string, masterKey: string, private _collection: DocDBCollectionTreeItem, isEmulator: boolean) {
        super(endpoint, masterKey, isEmulator);
    }

    public initChild(resource: ProcedureMeta): IAzureTreeItem {
        return new DocDBStoredProcedureTreeItem(this.documentEndpoint, this.masterKey, this.isEmulator, this._collection, resource);
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'stored procedures.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'stored procedures.svg')
        };
    }

    public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        const client = this.getDocumentClient();
        let spID = await vscode.window.showInputBox({
            prompt: "Enter a unique stored Procedure ID",
            ignoreFocusOut: true
        });

        if (spID || spID === "") {
            spID = spID.trim();
            showCreatingNode(spID);
            const sproc: ProcedureMeta = await new Promise<ProcedureMeta>((resolve, reject) => {
                client.createStoredProcedure(this.link, { id: spID, body: defaultStoredProcedure }, (err, result: ProcedureMeta) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(result);
                    }
                });
            });

            return this.initChild(sproc);
        }
        throw new UserCancelledError();
    }

    public get id(): string {
        return "$StoredProcedures";
    }

    public get label(): string {
        return "Stored Procedures";
    }

    public get link(): string {
        return this._collection.link;
    }

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<ProcedureMeta>> {
        return await client.readStoredProcedures(this.link, feedOptions);
    }
}
