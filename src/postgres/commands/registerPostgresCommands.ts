/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommand } from "vscode-azureextensionui";
import { doubleClickDebounceDelay } from "../../constants";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { createPostgresDatabase } from "./createPostgresDatabase";
import { deletePostgresDatabase } from "./deletePostgresDatabase";
import { deletePostgresFunction } from "./deletePostgresFunction";
import { deletePostgresServer } from "./deletePostgresServer";
import { deletePostgresTable } from "./deletePostgresTable";
import { enterPostgresCredentials } from "./enterPostgresCredentials";
import { openPostgresFunction } from "./openPostgresFunction";

export function registerPostgresCommands(): void {
    registerCommand('azureDatabases.deletePostgresServer', deletePostgresServer);
    registerCommand('azureDatabases.enterPostgresCredentials', enterPostgresCredentials);
    registerCommand('azureDatabases.configurePostgresFirewall', configurePostgresFirewall);
    registerCommand('azureDatabases.createPostgresDatabase', createPostgresDatabase);
    registerCommand('azureDatabases.deletePostgresDatabase', deletePostgresDatabase);
    registerCommand('azureDatabases.deletePostgresTable', deletePostgresTable);
    registerCommand('azureDatabases.openPostgresFunction', openPostgresFunction, doubleClickDebounceDelay);
    registerCommand('azureDatabases.deletePostgresFunction', deletePostgresFunction);
}
