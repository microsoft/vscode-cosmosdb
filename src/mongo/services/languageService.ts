import { TextDocumentPositionParams, TextDocuments, IConnection, InitializeParams, InitializeResult, CompletionItem } from 'vscode-languageserver';
import URI from 'vscode-uri';
import { MongoClient, Db } from 'mongodb';
import { MongoScriptDocumentManager } from './mongoScript';

export class LanguageService {

	private textDocuments: TextDocuments = new TextDocuments();
	private mongoDocumentsManager: MongoScriptDocumentManager = new MongoScriptDocumentManager();
	private db: Db;

	constructor(connection: IConnection) {
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
			MongoClient.connect(connectionParams.connectionString).then(db => this.db = db);
		});

		connection.onRequest('disconnect', () => {
			this.db = null;
		});
	}

	provideCompletionItems(positionParams: TextDocumentPositionParams): Promise<CompletionItem[]> {
		const textDocument = this.textDocuments.get(positionParams.textDocument.uri);
		const mongoScriptDocument = this.mongoDocumentsManager.getDocument(textDocument, this.db);
		return mongoScriptDocument.provideCompletionItemsAt(positionParams.position);
	}
}