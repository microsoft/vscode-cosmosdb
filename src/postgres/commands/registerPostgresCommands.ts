/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { languages } from "vscode";
import { callWithTelemetryAndErrorHandling, IActionContext, registerCommand } from "vscode-azureextensionui";
import { connectedPostgresKey, doubleClickDebounceDelay, postgresBaseFileName, sqlFileExtension } from "../../constants";
import { ext } from "../../extensionVariables";
import { PostgresCodeLensProvider } from "../services/PostgresCodeLensProvider";
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { connectPostgresDatabase } from "./connectPostgresDatabase";
import { createPostgresDatabase } from "./createPostgresDatabase";
import { createPostgresFunctionQuery } from "./createPostgresFunctionQuery";
import { createPostgresServer } from "./createPostgresServer";
import { deletePostgresDatabase } from "./deletePostgresDatabase";
import { deletePostgresFunction } from "./deletePostgresFunction";
import { deletePostgresServer } from "./deletePostgresServer";
import { deletePostgresTable } from "./deletePostgresTable";
import { enterPostgresCredentials } from "./enterPostgresCredentials";
import { executePostgresQuery } from "./executePostgresQuery";
import { openPostgresFunction } from "./openPostgresFunction";

export function registerPostgresCommands(): void {
    ext.postgresCodeLensProvider = new PostgresCodeLensProvider();
    ext.context.subscriptions.push(languages.registerCodeLensProvider({ pattern: `{**/,}*${postgresBaseFileName}*${sqlFileExtension}` }, ext.postgresCodeLensProvider));

    // tslint:disable-next-line: no-floating-promises
    loadPersistedPostgresDatabase();

    registerCommand('postgreSQL.createServer', createPostgresServer);
    registerCommand('postgreSQL.deleteServer', deletePostgresServer);
    registerCommand('postgreSQL.enterCredentials', enterPostgresCredentials);
    registerCommand('postgreSQL.configureFirewall', configurePostgresFirewall);
    registerCommand('postgreSQL.createDatabase', createPostgresDatabase);
    registerCommand('postgreSQL.deleteDatabase', deletePostgresDatabase);
    registerCommand('postgreSQL.deleteTable', deletePostgresTable);
    registerCommand('postgreSQL.openFunction', openPostgresFunction, doubleClickDebounceDelay);
    registerCommand('postgreSQL.deleteFunction', deletePostgresFunction);
    registerCommand('postgreSQL.connectDatabase', connectPostgresDatabase);
    registerCommand('postgreSQL.createFunctionQuery', createPostgresFunctionQuery);
    registerCommand('postgreSQL.executeQuery', executePostgresQuery);
}

export async function loadPersistedPostgresDatabase(): Promise<void> {
    // NOTE: We want to make sure this function never throws or returns a rejected promise because it gets awaited multiple times
    await callWithTelemetryAndErrorHandling('postgreSQL.loadPersistedDatabase', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.isActivationEvent = 'true';

        try {
            const persistedTreeItemId: string | undefined = ext.context.globalState.get(connectedPostgresKey);
            if (persistedTreeItemId) {
                const persistedTreeItem: PostgresDatabaseTreeItem | undefined = <PostgresDatabaseTreeItem>await ext.tree.findTreeItem(persistedTreeItemId, context);
                if (persistedTreeItem) {
                    await connectPostgresDatabase(context, persistedTreeItem);
                }
            }
        } finally {
            // Get code lens provider out of initializing state if there's no connected DB
            if (!ext.connectedPostgresDB && ext.postgresCodeLensProvider) {
                ext.postgresCodeLensProvider.setConnectedDatabase(undefined);
            }
        }
    });
}
