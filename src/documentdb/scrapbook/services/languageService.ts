/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable import/no-internal-modules */

// NOTE: This file may not take a dependency on vscode or anything that takes a dependency on it (such as @microsoft/vscode-azext-utils)

import { type Db } from 'mongodb';
import {
    getLanguageService,
    type LanguageService as JsonLanguageService,
    type SchemaConfiguration,
} from 'vscode-json-languageservice';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {
    createConnection,
    ProposedFeatures,
    TextDocuments,
    TextDocumentSyncKind,
    type CompletionItem,
    type InitializeParams,
    type InitializeResult,
    type TextDocumentPositionParams,
} from 'vscode-languageserver/node';
import { connectToClient } from '../connectToClient';
import { type IConnectionParams } from './IConnectionParams';
import { MongoScriptDocumentManager } from './mongoScript';
import { SchemaService } from './schemaService';

export class LanguageService {
    private textDocuments: TextDocuments<TextDocument> = new TextDocuments(TextDocument);
    private readonly mongoDocumentsManager: MongoScriptDocumentManager;
    private db: Db | null = null;

    private readonly jsonLanguageService: JsonLanguageService;
    private readonly schemaService: SchemaService;
    private schemas: SchemaConfiguration[];

    constructor() {
        // Create a connection for the server
        const connection = createConnection(ProposedFeatures.all);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        console.log = connection.console.log.bind(connection.console);

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        console.error = connection.console.error.bind(connection.console);
        this.schemaService = new SchemaService();

        // Make the text document manager listen on the connection
        // for open, change and close text document events
        this.textDocuments.listen(connection);

        // Listen on the connection
        connection.listen();

        // After the server has started the client sends an initialize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilities.
        connection.onInitialize((_params: InitializeParams): InitializeResult => {
            return {
                capabilities: {
                    textDocumentSync: TextDocumentSyncKind.Full, // Tell the client that the server works in FULL text document sync mode
                    completionProvider: { triggerCharacters: ['.'] },
                },
            };
        });

        connection.onCompletion((textDocumentPosition) => {
            return this.provideCompletionItems(textDocumentPosition);
        });

        connection.onRequest('connect', (connectionParams: IConnectionParams) => {
            void connectToClient(
                connectionParams.connectionString,
                connectionParams.extensionUserAgent,
                connectionParams.emulatorConfiguration,
            ).then((account) => {
                this.db = account.db(connectionParams.databaseName);
                void this.schemaService.registerSchemas(this.db).then((schemas) => {
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
            schemaRequestService: (uri) => this.schemaService.resolveSchema(uri),
            contributions: [],
        });

        this.mongoDocumentsManager = new MongoScriptDocumentManager(this.schemaService, this.jsonLanguageService);
    }

    public provideCompletionItems(positionParams: TextDocumentPositionParams): Promise<CompletionItem[]> {
        const textDocument = this.textDocuments.get(positionParams.textDocument.uri);

        if (!textDocument || !this.db) {
            return Promise.resolve([]);
        }

        const mongoScriptDocument = this.mongoDocumentsManager.getDocument(textDocument, this.db);
        return mongoScriptDocument.provideCompletionItemsAt(positionParams.position);
    }

    public resetSchema(uri: string): void {
        this.jsonLanguageService.resetSchema(uri);
    }

    public configureSchemas(schemas: SchemaConfiguration[]): void {
        this.jsonLanguageService.configure({
            schemas,
        });
    }
}
