/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DocumentClient, FeedOptions, ProcedureMeta, QueryIterator } from 'documentdb';
import * as path from 'path';
import * as vscode from "vscode";
import { UserCancelledError } from 'vscode-azureextensionui';
import { defaultStoredProcedure } from '../../constants';
import { GraphCollectionTreeItem } from '../../graph/tree/GraphCollectionTreeItem';
import { DocDBCollectionTreeItem } from './DocDBCollectionTreeItem';
import { DocDBStoredProcedureTreeItem } from './DocDBStoredProcedureTreeItem';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';

/**
 * This class represents the DocumentDB "Stored Procedures" node in the tree
 */
export class DocDBStoredProceduresTreeItem extends DocDBTreeItemBase<ProcedureMeta> {
    public static contextValue: string = "cosmosDBStoredProceduresGroup";
    public readonly contextValue: string = DocDBStoredProceduresTreeItem.contextValue;
    public readonly childTypeLabel: string = "Stored Procedure";
    public readonly parent: DocDBCollectionTreeItem | GraphCollectionTreeItem;

    constructor(parent: DocDBCollectionTreeItem | GraphCollectionTreeItem) {
        super(parent);
    }

    public initChild(resource: ProcedureMeta): DocDBStoredProcedureTreeItem {
        return new DocDBStoredProcedureTreeItem(this, resource);
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'stored procedures.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'stored procedures.svg')
        };
    }

    public async createChildImpl(showCreatingTreeItem: (label: string) => void): Promise<DocDBStoredProcedureTreeItem> {
        const client = this.root.getDocumentClient();
        let spID = await vscode.window.showInputBox({
            prompt: "Enter a unique stored procedure ID",
            validateInput: this.validateName,
            ignoreFocusOut: true
        });

        if (spID || spID === "") {
            spID = spID.trim();
            showCreatingTreeItem(spID);
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
        return this.parent.link;
    }

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<ProcedureMeta>> {
        return await client.readStoredProcedures(this.link, feedOptions);
    }

    private validateName(name: string): string | null | undefined {
        if (name) {
            if (name.indexOf("/") !== -1 || name.indexOf("\\") !== -1 || name.indexOf("?") !== -1 || name.indexOf("#") !== -1) {
                return "Id contains illegal chars: /,\\,?,#";
            }
            if (name[name.length - 1] === " ") {
                return "Id ends with a space.";
            }
        }
        return null;
    }
}
