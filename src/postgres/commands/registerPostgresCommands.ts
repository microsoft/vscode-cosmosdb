/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { callWithTelemetryAndErrorHandling, IActionContext, registerCommandWithTreeNodeUnwrapping } from "@microsoft/vscode-azext-utils";
import { defaults } from "pg";
import { languages } from "vscode";
import { connectedPostgresKey, doubleClickDebounceDelay, postgresDefaultDatabase, postgresLanguageId } from "../../constants";
import { ext } from "../../extensionVariables";
import { openUrl } from "../../utils/openUrl";
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
import { executePostgresQueryInDocument } from "./executePostgresQueryInDocument";
import { openPostgresFunction } from "./openPostgresFunction";
import { openPostgresStoredProcedure } from "./openPostgresStoredProcedure";

export function registerPostgresCommands(): void {
    ext.postgresCodeLensProvider = new PostgresCodeLensProvider();
    ext.context.subscriptions.push(languages.registerCodeLensProvider(postgresLanguageId, ext.postgresCodeLensProvider));

    void loadPersistedPostgresDatabase();

    //update defaults.database of 'pg'
    defaults.database = postgresDefaultDatabase;

    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteServer', deletePostgresServer);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.enterCredentials', enterPostgresCredentials);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.configureFirewall', configurePostgresFirewall);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.createDatabase', createPostgresDatabase);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteDatabase', deletePostgresDatabase);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteTable', deletePostgresTable);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.openFunction', openPostgresFunction, doubleClickDebounceDelay);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.openStoredProcedure', openPostgresStoredProcedure, doubleClickDebounceDelay);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteFunction', deletePostgresFunction);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteStoredProcedure', deletePostgresStoredProcedure);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.connectDatabase', connectPostgresDatabase);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.createFunctionQuery', createPostgresFunctionQuery);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.createStoredProcedureQuery', createPostgresStoredProcedureQuery);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.executeQuery', executePostgresQueryInDocument);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.copyConnectionString', copyConnectionString);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.showPasswordlessWiki', showPasswordlessWiki);
}

export async function loadPersistedPostgresDatabase(): Promise<void> {
    // NOTE: We want to make sure this function never throws or returns a rejected promise because it gets awaited multiple times
    await callWithTelemetryAndErrorHandling('postgreSQL.loadPersistedDatabase', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.isActivationEvent = 'true';

        try {
            const persistedTreeItemId: string | undefined = ext.context.globalState.get(connectedPostgresKey);
            if (persistedTreeItemId) {
                const persistedTreeItem: PostgresDatabaseTreeItem | undefined = <PostgresDatabaseTreeItem>await ext.rgApi.appResourceTree.findTreeItem(persistedTreeItemId, context);
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

export function showPasswordlessWiki(): void {
    // @todo: Create forward link
    openUrl("https://aka.ms/postgresql-passwordless-wiki");
}
