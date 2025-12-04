/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommand, registerCommandWithTreeNodeUnwrapping } from '@microsoft/vscode-azext-utils';
import { connectNoSqlContainer } from './commands/connectNoSqlContainer';
import { executeNoSqlQuery } from './commands/executeNoSqlQuery';
import { getNoSqlQueryPlan } from './commands/getNoSqlQueryPlan';
import { writeNoSqlQuery } from './commands/writeNoSqlQuery';

export function registerCosmosDBCommands(): void {
    // # region Scrapbook command
    registerCommandWithTreeNodeUnwrapping('cosmosDB.writeNoSqlQuery', writeNoSqlQuery);
    registerCommand('cosmosDB.connectNoSqlContainer', connectNoSqlContainer);
    registerCommand('cosmosDB.executeNoSqlQuery', executeNoSqlQuery);
    registerCommand('cosmosDB.getNoSqlQueryPlan', getNoSqlQueryPlan);
    // #endregion
}
