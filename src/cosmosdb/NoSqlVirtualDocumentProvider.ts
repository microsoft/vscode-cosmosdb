/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from './NoSqlCodeLensProvider';
import { type SerializedQueryResult } from './types/queryResult';

export interface NoSqlVirtualDocumentContent {
    connection: NoSqlQueryConnection | null;
    query: string;
    results: SerializedQueryResult | null;
    timestamp: number;
}

export class NoSqlVirtualDocumentProvider implements vscode.TextDocumentContentProvider {
    public static readonly scheme = 'nosql-virtual';

    private _onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    private _documents = new Map<string, NoSqlVirtualDocumentContent>();

    public readonly onDidChange = this._onDidChangeEmitter.event;

    public provideTextDocumentContent(uri: vscode.Uri): string {
        const docContent = this._documents.get(uri.toString());
        if (!docContent) {
            return JSON.stringify(
                {
                    connection: null,
                    query: 'SELECT * FROM c',
                    results: null,
                    timestamp: Date.now(),
                },
                null,
                2,
            );
        }

        return JSON.stringify(docContent, null, 2);
    }

    public createDocument(
        connection: NoSqlQueryConnection | null,
        query: string = 'SELECT * FROM c',
        results: SerializedQueryResult | null = null,
    ): vscode.Uri {
        const timestamp = Date.now();
        const filename = connection
            ? `${connection.databaseId}-${connection.containerId}-${timestamp}.nosql`
            : `untitled-${timestamp}.nosql`;

        const uri = vscode.Uri.parse(`${NoSqlVirtualDocumentProvider.scheme}:${filename}`);

        const content: NoSqlVirtualDocumentContent = {
            connection,
            query,
            results,
            timestamp,
        };

        this._documents.set(uri.toString(), content);

        return uri;
    }

    public updateDocument(uri: vscode.Uri, updates: Partial<NoSqlVirtualDocumentContent>): void {
        const docContent = this._documents.get(uri.toString());
        if (docContent) {
            Object.assign(docContent, updates);
            this._onDidChangeEmitter.fire(uri);
        }
    }

    public getDocument(uri: vscode.Uri): NoSqlVirtualDocumentContent | undefined {
        return this._documents.get(uri.toString());
    }

    public deleteDocument(uri: vscode.Uri): void {
        this._documents.delete(uri.toString());
    }
}
