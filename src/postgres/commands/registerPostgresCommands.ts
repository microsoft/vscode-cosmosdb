/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommand } from "vscode-azureextensionui";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { deletePostgresServer } from "./deletePostgresServer";
import { enterPostgresCredentials } from "./enterPostgresCredentials";

export function registerPostgresCommands(): void {

    registerCommand('cosmosDB.deletePostgresServer', deletePostgresServer);
    registerCommand('cosmosDB.enterPostgresCredentials', enterPostgresCredentials);
    registerCommand('cosmosDB.configurePostgresFirewall', configurePostgresFirewall);

}
