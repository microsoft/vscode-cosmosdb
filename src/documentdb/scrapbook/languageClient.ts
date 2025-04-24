/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable import/no-internal-modules */

import { appendExtensionUserAgent } from '@microsoft/vscode-azext-utils';
import * as path from 'path';
import {
    LanguageClient,
    TransportKind,
    type LanguageClientOptions,
    type ServerOptions,
} from 'vscode-languageclient/node';
import { ext } from '../../extensionVariables';
import { type EmulatorConfiguration } from '../../utils/emulatorConfiguration';
import { type IConnectionParams } from './services/IConnectionParams';

export class MongoDBLanguageClient {
    public client: LanguageClient;

    constructor() {
        // The server is implemented in node
        const serverPath = ext.isBundle
            ? path.join('mongo-languageServer.bundle.js') // Run with webpack
            : path.join('out', 'src', 'mongo', 'languageServer.js'); // Run without webpack
        const serverModule = ext.context.asAbsolutePath(serverPath);
        // The debug options for the server
        const debugOptions = { execArgv: ['--nolazy', '--inspect=6005'] };

        // If the extension is launch in debug mode the debug server options are use
        // Otherwise the run options are used
        const serverOptions: ServerOptions = {
            run: { module: serverModule, transport: TransportKind.ipc },
            debug: { module: serverModule, transport: TransportKind.ipc, options: debugOptions },
        };

        // Options to control the language client
        const clientOptions: LanguageClientOptions = {
            // Register the server for mongo javascript documents
            documentSelector: [
                { language: 'mongo', scheme: 'file' },
                { language: 'mongo', scheme: 'untitled' },
            ],
        };

        // Create the language client.
        this.client = new LanguageClient('mongo', 'Mongo Language Server', serverOptions, clientOptions);

        // Push the disposable to the context's subscriptions so that the
        // client can be deactivated on extension deactivation
        ext.context.subscriptions.push({
            dispose: () => {
                return this.client?.stop();
            },
        });

        // Start the client. This will also launch the server
        void this.client.start();
    }

    public async connect(
        connectionString: string,
        databaseName: string,
        emulatorConfiguration?: EmulatorConfiguration,
    ): Promise<void> {
        await this.client.sendRequest('connect', <IConnectionParams>{
            connectionString: connectionString,
            databaseName: databaseName,
            extensionUserAgent: appendExtensionUserAgent(),
            emulatorConfiguration: emulatorConfiguration,
        });
    }

    public async disconnect(): Promise<void> {
        await this.client.sendRequest('disconnect');
    }
}
