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
 * This class represents the DocumentDB "Stored Procedures" node in the tree
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
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'stored procedures.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'theme-agnostic', 'stored procedures.svg')
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
}
