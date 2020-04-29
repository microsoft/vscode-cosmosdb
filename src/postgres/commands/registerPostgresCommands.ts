/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommand } from "vscode-azureextensionui";
import { doubleClickDebounceDelay } from "../../constants";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { createPostgresDatabase } from "./createPostgresDatabase";
import { createPostgresServer } from "./createPostgresServer";
import { deletePostgresDatabase } from "./deletePostgresDatabase";
import { deletePostgresFunction } from "./deletePostgresFunction";
import { deletePostgresServer } from "./deletePostgresServer";
import { deletePostgresTable } from "./deletePostgresTable";
import { enterPostgresCredentials } from "./enterPostgresCredentials";
import { openPostgresFunction } from "./openPostgresFunction";

export function registerPostgresCommands(): void {
    registerCommand('postgreSQL.createServer', createPostgresServer);
    registerCommand('postgreSQL.deleteServer', deletePostgresServer);
    registerCommand('postgreSQL.enterCredentials', enterPostgresCredentials);
    registerCommand('postgreSQL.configureFirewall', configurePostgresFirewall);
    registerCommand('postgreSQL.createDatabase', createPostgresDatabase);
    registerCommand('postgreSQL.deleteDatabase', deletePostgresDatabase);
    registerCommand('postgreSQL.deleteTable', deletePostgresTable);
    registerCommand('postgreSQL.openFunction', openPostgresFunction, doubleClickDebounceDelay);
    registerCommand('postgreSQL.deleteFunction', deletePostgresFunction);
}
