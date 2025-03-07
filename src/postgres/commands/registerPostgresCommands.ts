/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommandWithTreeNodeUnwrapping } from '@microsoft/vscode-azext-utils';
import { defaults } from 'pg';
import * as vscode from 'vscode';
import { removeConnectionV1 } from '../../commands/removeConnection/removeConnection';
import { doubleClickDebounceDelay, postgresDefaultDatabase, postgresLanguageId } from '../../constants';
import { ext } from '../../extensionVariables';
import { PostgresCodeLensProvider } from '../services/PostgresCodeLensProvider';
import { configurePostgresFirewall } from './configurePostgresFirewall';
import { connectPostgresDatabase } from './connectPostgresDatabase';
import { copyConnectionString } from './copyConnectionString';
import { createPostgresDatabase } from './createPostgresDatabase';
import { createPostgresFunctionQuery } from './createPostgresQuery/function/createPostgresFunctionQuery';
import { createPostgresStoredProcedureQuery } from './createPostgresQuery/storedProcedure/createPostgresStoredProcedureQuery';
import { deletePostgresDatabase } from './deletePostgresDatabase';
import { deletePostgresFunction } from './deletePostgresFunction';
import { deletePostgresServer } from './deletePostgresServer';
import { deletePostgresStoredProcedure } from './deletePostgresStoredProcedure';
import { deletePostgresTable } from './deletePostgresTable';
import { enterPostgresCredentials } from './enterPostgresCredentials';
import { executePostgresQueryInDocument, loadPersistedPostgresDatabase } from './executePostgresQueryInDocument';
import { openPostgresFunction } from './openPostgresFunction';
import { openPostgresStoredProcedure } from './openPostgresStoredProcedure';
import { showPasswordlessWiki } from './showPasswordlessWiki';

export function registerPostgresCommands(): void {
    ext.postgresCodeLensProvider = new PostgresCodeLensProvider();
    ext.context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(postgresLanguageId, ext.postgresCodeLensProvider),
    );

    void loadPersistedPostgresDatabase();

    //update defaults.database of 'pg'
    defaults.database = postgresDefaultDatabase;

    registerCommandWithTreeNodeUnwrapping('postgreSQL.executeQuery', executePostgresQueryInDocument);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.showPasswordlessWiki', showPasswordlessWiki);

    // #region Server command

    registerCommandWithTreeNodeUnwrapping('postgreSQL.detachServer', removeConnectionV1);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteServer', deletePostgresServer);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.enterCredentials', enterPostgresCredentials);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.configureFirewall', configurePostgresFirewall);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.createDatabase', createPostgresDatabase);

    // #endregion

    // #region Database command

    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteDatabase', deletePostgresDatabase);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.connectDatabase', connectPostgresDatabase);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.copyConnectionString', copyConnectionString);

    // #endregion

    // #region TableGroup command

    // #endregion

    // #region StoredProcedureGroup command

    registerCommandWithTreeNodeUnwrapping('postgreSQL.createStoredProcedureQuery', createPostgresStoredProcedureQuery);

    // #endregion

    // #region FunctionGroup command

    registerCommandWithTreeNodeUnwrapping('postgreSQL.createFunctionQuery', createPostgresFunctionQuery);

    // #endregion

    // #region Table command

    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteTable', deletePostgresTable);

    // #endregion

    // #region StoredProcedure command

    registerCommandWithTreeNodeUnwrapping(
        'postgreSQL.openStoredProcedure',
        openPostgresStoredProcedure,
        doubleClickDebounceDelay,
    );
    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteStoredProcedure', deletePostgresStoredProcedure);

    // #endregion

    // #region Function command

    registerCommandWithTreeNodeUnwrapping('postgreSQL.openFunction', openPostgresFunction, doubleClickDebounceDelay);
    registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteFunction', deletePostgresFunction);

    // #endregion
}
