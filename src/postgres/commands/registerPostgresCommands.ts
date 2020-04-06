/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, registerCommand } from "vscode-azureextensionui";
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { deleteDatabase } from "./deleteDatabase";
import { enterPostgresCredentials } from "./enterPostgresCredentials";

export function registerPostgresCommands(): void {
    registerCommand('cosmosDB.enterPostgresCredentials', enterPostgresCredentials);
    registerCommand('cosmosDB.configurePostgresFirewall', configurePostgresFirewall);
    registerCommand('cosmosDB.deletePostgresDatabase', async (context: IActionContext, node?: PostgresDatabaseTreeItem) => { await deleteDatabase(context, node); });
}
