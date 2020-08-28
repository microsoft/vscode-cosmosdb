/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { defaults } from "pg";
import { languages } from "vscode";
import { callWithTelemetryAndErrorHandling, IActionContext, registerCommand } from "vscode-azureextensionui";
import { connectedPostgresKey, doubleClickDebounceDelay, postgresLanguageId } from "../../constants";
import { ext } from "../../extensionVariables";
import { PostgresCodeLensProvider } from "../services/PostgresCodeLensProvider";
import { PostgresDatabaseTreeItem } from "../tree/PostgresDatabaseTreeItem";
import { configurePostgresFirewall } from "./configurePostgresFirewall";
import { connectPostgresDatabase } from "./connectPostgresDatabase";
import { copyConnectionString } from "./copyConnectionString";
import { createPostgresDatabase } from "./createPostgresDatabase";
import { createPostgresFunctionQuery } from "./createPostgresQuery/function/createPostgresFunctionQuery";
import { createPostgresStoredProcedureQuery } from "./createPostgresQuery/storedProcedure/createPostgresStoredProcedureQuery";
import { deletePostgresDatabase } from "./deletePostgresDatabase";
import { deletePostgresFunction } from "./deletePostgresFunction";
import { deletePostgresServer } from "./deletePostgresServer";
import { deletePostgresStoredProcedure } from "./deletePostgresStoredProcedure";
import { deletePostgresTable } from "./deletePostgresTable";
import { enterPostgresCredentials } from "./enterPostgresCredentials";
import { executePostgresQuery } from "./executePostgresQuery";
import { openPostgresFunction } from "./openPostgresFunction";
import { openPostgresStoredProcedure } from "./openPostgresStoredProcedure";

export function registerPostgresCommands(): void {
    ext.postgresCodeLensProvider = new PostgresCodeLensProvider();
    ext.context.subscriptions.push(languages.registerCodeLensProvider(postgresLanguageId, ext.postgresCodeLensProvider));

    // tslint:disable-next-line: no-floating-promises
    loadPersistedPostgresDatabase();

    //update defaults.database of 'pg'
    defaults.database = 'postgres';

    registerCommand('postgreSQL.deleteServer', deletePostgresServer);
    registerCommand('postgreSQL.enterCredentials', enterPostgresCredentials);
    registerCommand('postgreSQL.configureFirewall', configurePostgresFirewall);
    registerCommand('postgreSQL.createDatabase', createPostgresDatabase);
    registerCommand('postgreSQL.deleteDatabase', deletePostgresDatabase);
    registerCommand('postgreSQL.deleteTable', deletePostgresTable);
    registerCommand('postgreSQL.openFunction', openPostgresFunction, doubleClickDebounceDelay);
    registerCommand('postgreSQL.openStoredProcedure', openPostgresStoredProcedure, doubleClickDebounceDelay);
    registerCommand('postgreSQL.deleteFunction', deletePostgresFunction);
    registerCommand('postgreSQL.deleteStoredProcedure', deletePostgresStoredProcedure);
    registerCommand('postgreSQL.connectDatabase', connectPostgresDatabase);
    registerCommand('postgreSQL.createFunctionQuery', createPostgresFunctionQuery);
    registerCommand('postgreSQL.createStoredProcedureQuery', createPostgresStoredProcedureQuery);
    registerCommand('postgreSQL.executeQuery', executePostgresQuery);
    registerCommand('postgreSQL.copyConnectionString', copyConnectionString);
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
