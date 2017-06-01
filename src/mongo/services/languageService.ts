/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { TextDocumentPositionParams, TextDocuments, IConnection, InitializeParams, InitializeResult, CompletionItem } from 'vscode-languageserver';
import URI from 'vscode-uri';
import { MongoClient, Db, Cursor } from 'mongodb';
import { MongoScriptDocumentManager } from './mongoScript';
import SchemaService from './schemaService';
import { getLanguageService, LanguageService as JsonLanguageService, SchemaConfiguration } from 'vscode-json-languageservice';
import { JSONSchema } from 'vscode-json-languageservice/lib/jsonSchema';

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
		let workspaceRoot: URI;
		connection.onInitialize((params: InitializeParams): InitializeResult => {
			workspaceRoot = URI.parse(params.rootPath);
			return {
				capabilities: {
					textDocumentSync: this.textDocuments.syncKind, // Tell the client that the server works in FULL text document sync mode
					completionProvider: { triggerCharacters: ['.'] },
				}
			};
		});

		connection.onCompletion(textDocumentPosition => {
			return this.provideCompletionItems(textDocumentPosition);
		});

		connection.onRequest('connect', (connectionParams) => {
			MongoClient.connect(connectionParams.connectionString)
				.then(db => {
					this.db = db;
					this.schemaService.registerSchemas(this.db)
						.then(schemas => {
							this.configureSchemas(schemas);
						})
				});
		});

		connection.onRequest('disconnect', () => {
			this.db = null;
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

	provideCompletionItems(positionParams: TextDocumentPositionParams): Promise<CompletionItem[]> {
		const textDocument = this.textDocuments.get(positionParams.textDocument.uri);
		const mongoScriptDocument = this.mongoDocumentsManager.getDocument(textDocument, this.db);
		return mongoScriptDocument.provideCompletionItemsAt(positionParams.position);
	}

	resetSchema(uri: string) {
		this.jsonLanguageService.resetSchema(uri);
	}

	configureSchemas(schemas: SchemaConfiguration[]): void {
		this.jsonLanguageService.configure({
			schemas
		})
	}
}