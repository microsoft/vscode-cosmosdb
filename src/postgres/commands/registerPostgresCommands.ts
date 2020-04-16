/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommand } from "vscode-azureextensionui";
import { doubleClickDebounceDelay } from "../../constants";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { createPostgresServer } from "./createPostgresServer";
import { deletePostgresDatabase } from "./deletePostgresDatabase";
import { deletePostgresServer } from "./deletePostgresServer";
import { deletePostgresTable } from "./deletePostgresTable";
import { enterPostgresCredentials } from "./enterPostgresCredentials";
import { openPostgresFunction } from "./openPostgresFunction";

export function registerPostgresCommands(): void {
    registerCommand('cosmosDB.deletePostgresServer', deletePostgresServer);
    registerCommand('cosmosDB.enterPostgresCredentials', enterPostgresCredentials);
    registerCommand('cosmosDB.configurePostgresFirewall', configurePostgresFirewall);
    registerCommand('cosmosDB.deletePostgresDatabase', deletePostgresDatabase);
    registerCommand('cosmosDB.deletePostgresTable', deletePostgresTable);
    registerCommand('cosmosDB.openPostgresFunction', openPostgresFunction, doubleClickDebounceDelay);
    registerCommand('cosmosDB.createPostgresServer', createPostgresServer);
}
