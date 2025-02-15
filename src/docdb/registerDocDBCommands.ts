/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerCommand, registerCommandWithTreeNodeUnwrapping } from '@microsoft/vscode-azext-utils';
import { languages } from 'vscode';
import { ext } from '../extensionVariables';
import { connectNoSqlContainer } from './commands/connectNoSqlContainer';
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
}
