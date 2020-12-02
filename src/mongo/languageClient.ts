/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import { appendExtensionUserAgent } from 'vscode-azureextensionui';
import { LanguageClient, LanguageClientOptions, ServerOptions, TransportKind } from 'vscode-languageclient';
import * as nls from 'vscode-nls';
import { ext } from '../extensionVariables';

const localize = nls.loadMessageBundle();

// tslint:disable-next-line: export-name
export class MongoDBLanguageClient {

    public client: LanguageClient;

    constructor() {
        // The server is implemented in node
        const serverModule = ext.ignoreBundle ?
            ext.context.asAbsolutePath(path.join('out', 'src', 'mongo', 'languageServer.js')) :
            ext.context.asAbsolutePath(path.join('dist', 'mongo-languageServer.bundle.js'));
        // The debug options for the server
        const debugOptions = { execArgv: ['--nolazy', '--inspect=6005'] };

        // If the extension is launch in debug mode the debug server options are use
        // Otherwise the run options are used
        const serverOptions: ServerOptions = {
            run: { module: serverModule, transport: TransportKind.ipc },
            debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions }
        };

        // Options to control the language client
        const clientOptions: LanguageClientOptions = {
            // Register the server for mongo javascript documents
            documentSelector: [
                { language: 'mongo', scheme: 'file' },
                { language: 'mongo', scheme: 'untitled' }
            ]
        };

        // Create the language client and start the client.
        this.client = new LanguageClient('mongo', localize('mongo.server.name', 'Mongo Language Server'), serverOptions, clientOptions);
        const disposable = this.client.start();

        // Push the disposable to the context's subscriptions so that the
        // client can be deactivated on extension deactivation
        ext.context.subscriptions.push(disposable);
    }

    public async connect(connectionString: string, databaseName: string): Promise<void> {
        await this.client.sendRequest('connect', <IConnectionParams>{ connectionString: connectionString, databaseName: databaseName, extensionUserAgent: appendExtensionUserAgent() });
    }

    public async disconnect(): Promise<void> {
        await this.client.sendRequest('disconnect');
    }
}
