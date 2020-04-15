/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IActionContext, registerCommand } from "vscode-azureextensionui";
import { doubleClickDebounceDelay } from "../../constants";
import { CosmosEditorManager } from "../../CosmosEditorManager";
import { PostgresFunctionTreeItem } from "../tree/PostgresFunctionTreeItem";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { createPostgresFunction } from "./createPostgresFunction";
import { deletePostgresDatabase } from "./deletePostgresDatabase";
import { deletePostgresServer } from "./deletePostgresServer";
import { enterPostgresCredentials } from "./enterPostgresCredentials";
import { openPostgresFunction } from "./openPostgresFunction";

export function registerPostgresCommands(editorManager: CosmosEditorManager): void {
    registerCommand('cosmosDB.deletePostgresServer', deletePostgresServer);
    registerCommand('cosmosDB.enterPostgresCredentials', enterPostgresCredentials);
    registerCommand('cosmosDB.configurePostgresFirewall', configurePostgresFirewall);
    registerCommand('cosmosDB.deletePostgresDatabase', deletePostgresDatabase);
    registerCommand('cosmosDB.createPostgresFunction', createPostgresFunction);
    registerCommand('cosmosDB.openPostgresFunction', async (context: IActionContext, treeItem?: PostgresFunctionTreeItem) => {
        await openPostgresFunction(editorManager, context, treeItem);
        // tslint:disable-next-line:align
    }, doubleClickDebounceDelay);
}
