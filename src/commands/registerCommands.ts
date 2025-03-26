/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type IActionContext,
    registerCommand,
    registerCommandWithTreeNodeUnwrapping,
} from '@microsoft/vscode-azext-utils';
import type vscode from 'vscode';
import { doubleClickDebounceDelay } from '../constants';
import { registerCosmosCommands } from '../cosmosdb/registerCosmosCommands';
import { ext } from '../extensionVariables';
import { registerPostgresCommands } from '../postgres/commands/registerPostgresCommands';
import { copyAzureConnectionString } from './copyConnectionString/copyConnectionString';
import { cosmosDBCreateContainer, cosmosDBCreateGraph } from './createContainer/createContainer';
import { createAzureDatabase } from './createDatabase/createDatabase';
import { cosmosDBCreateDocument } from './createDocument/createDocument';
import { createServer } from './createServer/createServer';
import { cosmosDBCreateStoredProcedure } from './createStoredProcedure/createStoredProcedure';
import { cosmosDBCreateTrigger } from './createTrigger/createTrigger';
import { cosmosDBDeleteGraph, deleteAzureContainer } from './deleteContainer/deleteContainer';
import { deleteAzureDatabase } from './deleteDatabase/deleteDatabase';
import { deleteAzureDatabaseAccount } from './deleteDatabaseAccount/deleteDatabaseAccount';
import { cosmosDBDeleteItem } from './deleteItems/deleteItems';
import { cosmosDBDeleteStoredProcedure } from './deleteStoredProcedure/deleteStoredProcedure';
import { cosmosDBDeleteTrigger } from './deleteTrigger/deleteTrigger';
import { cosmosDBExecuteStoredProcedure } from './executeStoredProcedure/executeStoredProcedure';
import { importDocuments } from './importDocuments/importDocuments';
import { cosmosDBLoadMore } from './loadMore/loadMore';
import { newConnection } from './newConnection/newConnection';
import { newEmulatorConnection } from './newEmulatorConnection/newEmulatorConnection';
import { cosmosDBOpenItem } from './openDocument/openDocument';
import { cosmosDBOpenGraphExplorer } from './openGraphExplorer/cosmosDBOpenGraphExplorer';
import { openNoSqlQueryEditor } from './openNoSqlQueryEditor/openNoSqlQueryEditor';
import { cosmosDBOpenStoredProcedure } from './openStoredProcedure/openStoredProcedure';
import { cosmosDBOpenTrigger } from './openTrigger/openTrigger';
import { refreshTreeElement } from './refreshTreeElement/refreshTreeElement';
import { removeConnection } from './removeConnection/removeConnection';
import { cosmosDBViewContainerOffer, cosmosDBViewDatabaseOffer } from './viewOffer/viewOffer';

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
    registerDatabaseCommands();
    registerContainerCommands();
    registerDocumentCommands();
    registerStoredProcedureCommands();
    registerTriggerCommands();

    // old commands
    registerCosmosCommands();
    registerPostgresCommands();

    registerCommandWithTreeNodeUnwrapping('azureDatabases.refresh', refreshTreeElement);

    // For Cosmos DB FileSystem (Scrapbook)
    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.update',
        async (_actionContext: IActionContext, uri: vscode.Uri) => await ext.fileSystem.updateWithoutPrompt(uri),
    );
}

export function registerAccountCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDatabase', createAzureDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', deleteAzureDatabaseAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.newConnection', newConnection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.newEmulatorConnection', newEmulatorConnection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.removeConnection', removeConnection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', copyAzureConnectionString);
}

export function registerDatabaseCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createGraph', cosmosDBCreateGraph);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createContainer', cosmosDBCreateContainer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDatabase', deleteAzureDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.viewDatabaseOffer', cosmosDBViewDatabaseOffer);
}

export function registerContainerCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openNoSqlQueryEditor', openNoSqlQueryEditor);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.importDocument', importDocuments);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteGraph', cosmosDBDeleteGraph);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteContainer', deleteAzureContainer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.viewContainerOffer', cosmosDBViewContainerOffer);
}

export function registerDocumentCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocument', cosmosDBCreateDocument);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openGraphExplorer', cosmosDBOpenGraphExplorer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openDocument', cosmosDBOpenItem, doubleClickDebounceDelay);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocument', cosmosDBDeleteItem);
    registerCommand('cosmosDB.loadMore', cosmosDBLoadMore);
}

export function registerStoredProcedureCommands() {
    registerCommandWithTreeNodeUnwrapping(
        'cosmosDB.openStoredProcedure',
        cosmosDBOpenStoredProcedure,
        doubleClickDebounceDelay,
    );
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createStoredProcedure', cosmosDBCreateStoredProcedure);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.executeStoredProcedure', cosmosDBExecuteStoredProcedure);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteStoredProcedure', cosmosDBDeleteStoredProcedure);
}

export function registerTriggerCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createTrigger', cosmosDBCreateTrigger);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openTrigger', cosmosDBOpenTrigger, doubleClickDebounceDelay);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteTrigger', cosmosDBDeleteTrigger);
}
