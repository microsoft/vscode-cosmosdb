/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, registerCommandWithTreeNodeUnwrapping } from '@microsoft/vscode-azext-utils';
import { createDocDBDatabase } from '../docdb/commands/createDocDBDatabase';
import { ext } from '../extensionVariables';
import { createPostgresDatabase } from '../postgres/commands/createPostgresDatabase';
import { attachEmulator } from './attachEmulator/attachEmulator';
import { copyAzureConnectionString } from './copyConnectionString/copyConnectionString';
import { createServer } from './createServer/createServer';
import { deleteAzureDatabaseAccount, deletePostgresServer } from './deleteDatabaseAccount/deleteDatabaseAccount';
import { detachAzureDatabaseAccount, detachDatabaseAccountV1 } from './detachDatabaseAccount/detachDatabaseAccount';

/**
 * DISCLAIMER:
 * It does not any matter to which category the command belongs to as long as it is a command.
 * Today it might be a resource group command, tomorrow it might be a subscription command.
 * Therefore, it is better to categorize the command as a command.
 *
 * However, in this file the commands might be categorized using different functions.
 */

export function registerCommands(): void {
    registerCommandWithTreeNodeUnwrapping('azureDatabases.createServer', createServer);

    registerAccountCommands();
}

export function registerAccountCommands() {
    registerCommandWithTreeNodeUnwrapping('postgreSQL.createDatabase', createPostgresDatabase);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('postgreSQL.deleteServer', deletePostgresServer);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('postgreSQL.detachServer', detachDatabaseAccountV1);

    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBDatabase', createDocDBDatabase);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', deleteAzureDatabaseAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.attachDatabaseAccount', async (actionContext: IActionContext) => {
        await ext.attachedAccountsNode.attachNewAccount(actionContext);
        await ext.rgApi.workspaceResourceTree.refresh(actionContext, ext.attachedAccountsNode);
    });
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.attachEmulator', attachEmulator);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('azureDatabases.detachDatabaseAccount', detachAzureDatabaseAccount);
    /*[x]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', copyAzureConnectionString);
}
