/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { createConnection, IConnection } from 'vscode-languageserver';
import { LanguageService } from './services/languageService'

// Create a connection for the server
let connection: IConnection = createConnection();
console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);

new LanguageService(connection);

// Listen on the connection
connection.listen();