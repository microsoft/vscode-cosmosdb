/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConnection, type IConnection } from 'vscode-languageserver';
import { LanguageService } from './services/languageService';

//
//
//
// HOW TO DEBUG THE LANGUAGE SERVER
//
//
// 1. Start the extension via F5
// 2. Under vscode Debug pane, switch to "Attach to Language Server"
// 3. F5
//
//
//

// Create a connection for the server
const connection: IConnection = createConnection();
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
console.log = connection.console.log.bind(connection.console);
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
console.error = connection.console.error.bind(connection.console);

new LanguageService(connection);

// Listen on the connection
connection.listen();
