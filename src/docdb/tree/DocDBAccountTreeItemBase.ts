/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { DocumentClient, QueryIterator, DatabaseMeta, FeedOptions } from 'documentdb';
import { IAzureTreeItem, IAzureNode, UserCancelledError } from 'vscode-azureextensionui';
import { DocDBTreeItemBase } from './DocDBTreeItemBase';
import * as vscode from 'vscode';
import { IGremlinEndpoint } from '../../graph/gremlinEndpoints';

/**
 * This class provides common logic for DocumentDB, Graph, and Table accounts
 * (DocumentDB is the base type for all Cosmos DB accounts)
 */
export abstract class DocDBAccountTreeItemBase extends DocDBTreeItemBase<DatabaseMeta> {
    public readonly id: string;
    public readonly label: string;
    public readonly childTypeLabel: string = "Database";

    constructor(id: string, label: string, documentEndpoint: string, masterKey: string) {
        super(documentEndpoint, masterKey);
        this.id = id;
        this.label = label;
    }

    public get connectionString(): string {
        return `AccountEndpoint=${this.documentEndpoint};AccountKey=${this.masterKey}`;
    }

    public get iconPath(): any {
        return {
            light: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'light', 'CosmosDBAccount.svg'),
            dark: path.join(__filename, '..', '..', '..', '..', '..', 'resources', 'icons', 'dark', 'CosmosDBAccount.svg')
        };
    }

    public async getIterator(client: DocumentClient, feedOptions: FeedOptions): Promise<QueryIterator<DatabaseMeta>> {
        return await client.readDatabases(feedOptions);
    }

    public async createChild(_node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        const databaseName = await vscode.window.showInputBox({
            placeHolder: 'Database Name',
            validateInput: DocDBAccountTreeItemBase.validateDatabaseName,
            ignoreFocusOut: true
        });

        if (databaseName) {
            showCreatingNode(databaseName);
            const client = this.getDocumentClient();
            const database: DatabaseMeta = await new Promise<DatabaseMeta>((resolve, reject) => {
                client.createDatabase({ id: databaseName }, (err, database: DatabaseMeta) => {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(database);
                    }
                });
            });

            return this.initChild(database);
        }

        throw new UserCancelledError();
    }

    private static validateDatabaseName(name: string): string | undefined | null {
        if (!name || name.length < 1 || name.length > 255) {
            return "Name has to be between 1 and 255 chars long";
        }
        if (name.endsWith(" ")) {
            return "Database name cannot end with space";
        }
        if (/[/\\?#]/.test(name)) {
            return `Database name cannot contain the characters '\\', '/', '#', '?'`;
        }
        return undefined;
    }
}
