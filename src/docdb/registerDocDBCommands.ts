/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommand, registerCommandWithTreeNodeUnwrapping } from '@microsoft/vscode-azext-utils';
import { languages } from 'vscode';
import { ext } from '../extensionVariables';
import { connectNoSqlContainer } from './commands/connectNoSqlContainer';
import { createDocDBDocument } from './commands/createDocDBDocument';
import { createDocDBStoredProcedure } from './commands/createDocDBStoredProcedure';
import { createDocDBTrigger } from './commands/createDocDBTrigger';
import { executeDocDBStoredProcedure } from './commands/executeDocDBStoredProcedure';
import { executeNoSqlQuery } from './commands/executeNoSqlQuery';
import { getNoSqlQueryPlan } from './commands/getNoSqlQueryPlan';
import { writeNoSqlQuery } from './commands/writeNoSqlQuery';
import { NoSqlCodeLensProvider } from './NoSqlCodeLensProvider';

const nosqlLanguageId = 'nosql';

export function registerDocDBCommands(): void {
    ext.noSqlCodeLensProvider = new NoSqlCodeLensProvider();
    ext.context.subscriptions.push(languages.registerCodeLensProvider(nosqlLanguageId, ext.noSqlCodeLensProvider));

    // # region Scrapbook command
    registerCommandWithTreeNodeUnwrapping('cosmosDB.writeNoSqlQuery', writeNoSqlQuery);
    registerCommand('cosmosDB.connectNoSqlContainer', connectNoSqlContainer);
    registerCommand('cosmosDB.executeNoSqlQuery', executeNoSqlQuery);
    registerCommand('cosmosDB.getNoSqlQueryPlan', getNoSqlQueryPlan);
    // #endregion

    // #region DocumentGroup command

    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBDocument', createDocDBDocument);

    // #endregion

    // #region StoredProcedureGroup command

    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBStoredProcedure', createDocDBStoredProcedure);

    // #endregion

    // #region StoredProcedure command

    registerCommandWithTreeNodeUnwrapping('cosmosDB.executeDocDBStoredProcedure', executeDocDBStoredProcedure);

    // #endregion

    // #region TriggerGroup command

    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBTrigger', createDocDBTrigger);

    // #endregion
}
