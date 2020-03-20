/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// NOTE: This file may not take a dependencey on vscode or anything that takes a dependency on it (such as vscode-azureextensionui)

import { Db } from 'mongodb';
import { getLanguageService, LanguageService as JsonLanguageService, SchemaConfiguration } from 'vscode-json-languageservice';
import { CompletionItem, IConnection, InitializeParams, InitializeResult, TextDocumentPositionParams, TextDocuments } from 'vscode-languageserver';
import { connectToMongoClient } from '../connectToMongoClient';
import { MongoScriptDocumentManager } from './mongoScript';
import { SchemaService } from './schemaService';

// grandfathered-in
// tslint:disable: no-non-null-assertion

// tslint:disable-next-line: export-name
export class LanguageService {

    private textDocuments: TextDocuments = new TextDocuments();
    private readonly mongoDocumentsManager: MongoScriptDocumentManager;
    private db: Db;

    private jsonLanguageService: JsonLanguageService;
    private schemaService: SchemaService;
    private schemas: SchemaConfiguration[];

    constructor(connection: IConnection) {

        this.schemaService = new SchemaService();

        this.textDocuments.listen(connection);
        // After the server has started the client sends an initilize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilities.
        connection.onInitialize((_params: InitializeParams): InitializeResult => {
            return {
                capabilities: {
                    textDocumentSync: this.textDocuments.syncKind, // Tell the client that the server works in FULL text document sync mode
                    completionProvider: { triggerCharacters: ['.'] }
                }
            };
        });

        connection.onCompletion(textDocumentPosition => {
            return this.provideCompletionItems(textDocumentPosition);
        });

        connection.onRequest('connect', (connectionParams: IConnectionParams) => {
            // grandfathered in
            // tslint:disable-next-line: no-floating-promises
            connectToMongoClient(connectionParams.connectionString, connectionParams.extensionUserAgent)
                .then(account => {
                    this.db = account.db(connectionParams.databaseName);
                    this.schemaService.registerSchemas(this.db)
                        .then(schemas => {
                            this.configureSchemas(schemas);
                        });
                });
        });

        connection.onRequest('disconnect', () => {
            this.db = null!;
            for (const schema of this.schemas) {
                this.jsonLanguageService.resetSchema(schema.uri);
            }
        });

        this.jsonLanguageService = getLanguageService({
            schemaRequestService: uri => this.schemaService.resolveSchema(uri),
            contributions: []
        });

        this.mongoDocumentsManager = new MongoScriptDocumentManager(this.schemaService, this.jsonLanguageService);
    }

    public provideCompletionItems(positionParams: TextDocumentPositionParams): Promise<CompletionItem[]> {
        const textDocument = this.textDocuments.get(positionParams.textDocument.uri);
        const mongoScriptDocument = this.mongoDocumentsManager.getDocument(textDocument!, this.db);
        return mongoScriptDocument.provideCompletionItemsAt(positionParams.position);
    }

    public resetSchema(uri: string): void {
        this.jsonLanguageService.resetSchema(uri);
    }

    public configureSchemas(schemas: SchemaConfiguration[]): void {
        this.jsonLanguageService.configure({
            schemas
        });
    }
}
