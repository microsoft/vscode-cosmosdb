/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as nls from 'vscode-nls';
import { workspace, languages, ExtensionContext, extensions, Uri, Range } from 'vscode';
import { LanguageClient, LanguageClientOptions, RequestType, ServerOptions, TransportKind, NotificationType } from 'vscode-languageclient';
import { Database } from './mongo';

const localize = nls.loadMessageBundle();

namespace ConnectDBRequest {
	export const type: RequestType<string, string, any, any> = new RequestType('vscode/content');
}

namespace ColorSymbolRequest {
	export const type: RequestType<string, Range[], any, any> = new RequestType('json/colorSymbols');
}

export default class MongoDBLanguageClient {

	private client: LanguageClient;

	constructor(context: ExtensionContext) {
		// The server is implemented in node
		let serverModule = context.asAbsolutePath(path.join('out', 'src', 'mongo', 'languageServer.js'));
		// The debug options for the server
		let debugOptions = { execArgv: ['--nolazy', '--debug=6005'] };

		// If the extension is launch in debug mode the debug server options are use
		// Otherwise the run options are used
		let serverOptions: ServerOptions = {
			run: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
			debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
		};

		// Options to control the language client
		let clientOptions: LanguageClientOptions = {
			// Register the server for mongo javascript documents
			documentSelector: ['mongo'],
		};

		// Create the language client and start the client.
		this.client = new LanguageClient('mongo', localize('mongo.server.name', 'Mongo Language Server'), serverOptions, clientOptions);
		let disposable = this.client.start();

		// Push the disposable to the context's subscriptions so that the
		// client can be deactivated on extension deactivation
		context.subscriptions.push(disposable);
	}

	connect(database: Database): void {
		const uri = Uri.parse(database.server.id);
		const connectionString = `${uri.scheme}://${uri.authority}/${database.id}?${uri.query}`
		this.client.sendRequest('connect', { connectionString });
	}

	disconnect(): void {
		this.client.sendRequest('disconnect');
	}
}