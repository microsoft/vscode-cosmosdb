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
import {
    deployLLMInstructionsFiles,
    removeLLMInstructionsFiles,
} from '../cosmosdb/commands/deployLLMInstructionsFiles';
import { ext } from '../extensionVariables';
import { copyConnectionString } from './copyConnectionString/copyConnectionString';
import { cosmosDBCreateContainer } from './createContainer/createContainer';
import { cosmosDBCreateDatabase } from './createDatabase/createDatabase';
import { cosmosDBCreateDocument } from './createDocument/createDocument';
import { createServer } from './createServer/createServer';
import { cosmosDBCreateStoredProcedure } from './createStoredProcedure/createStoredProcedure';
import { cosmosDBCreateTrigger } from './createTrigger/createTrigger';
import { cosmosDBDeleteContainer } from './deleteContainer/deleteContainer';
import { cosmosDBDeleteDatabase } from './deleteDatabase/deleteDatabase';
import { cosmosDBDeleteDatabaseAccount } from './deleteDatabaseAccount/deleteDatabaseAccount';
import { cosmosDBDeleteItem } from './deleteItems/deleteItems';
import { cosmosDBDeleteStoredProcedure } from './deleteStoredProcedure/deleteStoredProcedure';
import { cosmosDBDeleteTrigger } from './deleteTrigger/deleteTrigger';
import { cosmosDBExecuteStoredProcedure } from './executeStoredProcedure/executeStoredProcedure';
import { filterTreeItems } from './filterTreeItems/filterTreeItems';
import { importDocuments } from './importDocuments/importDocuments';
import { cosmosDBLoadMore } from './loadMore/loadMore';
import { newConnection } from './newConnection/newConnection';
import { newEmulatorConnection } from './newEmulatorConnection/newEmulatorConnection';
import { cosmosDBOpenItem } from './openDocument/openDocument';
import { openNoSqlQueryEditor } from './openNoSqlQueryEditor/openNoSqlQueryEditor';
import { cosmosDBOpenStoredProcedure } from './openStoredProcedure/openStoredProcedure';
import { cosmosDBOpenTrigger } from './openTrigger/openTrigger';
import { openUnsupportedAccount } from './openUnsupportedAccount/openUnsupportedAccount';
import { refreshTreeElement } from './refreshTreeElement/refreshTreeElement';
import { cosmosDBRemoveConnection } from './removeConnection/removeConnection';
import { sortTreeItems } from './sortTreeItems/sortTreeItems';
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

    registerCommandWithTreeNodeUnwrapping('azureDatabases.refresh', refreshTreeElement);

    // For Cosmos DB FileSystem
    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.update',
        async (_actionContext: IActionContext, uri: vscode.Uri) => await ext.fileSystem.updateWithoutPrompt(uri),
    );

    registerCommandWithTreeNodeUnwrapping('azureDatabases.filterTreeItems', filterTreeItems);
    registerCommandWithTreeNodeUnwrapping('azureDatabases.sortTreeItems', sortTreeItems);

    registerLLMAssetsCommands();
}

export function registerAccountCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDatabase', cosmosDBCreateDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', cosmosDBDeleteDatabaseAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.newConnection', newConnection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.newEmulatorConnection', newEmulatorConnection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.removeConnection', cosmosDBRemoveConnection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', copyConnectionString);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openUnsupportedAccount', openUnsupportedAccount);
}

export function registerDatabaseCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createContainer', cosmosDBCreateContainer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDatabase', cosmosDBDeleteDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.viewDatabaseOffer', cosmosDBViewDatabaseOffer);
}

export function registerContainerCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openNoSqlQueryEditor', openNoSqlQueryEditor);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.importDocument', importDocuments);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteContainer', cosmosDBDeleteContainer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.viewContainerOffer', cosmosDBViewContainerOffer);
}

export function registerDocumentCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocument', cosmosDBCreateDocument);
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

export function registerLLMAssetsCommands() {
    registerCommand('cosmosDB.ai.deployInstructionFiles', deployLLMInstructionsFiles);
    registerCommand('cosmosDB.ai.removeInstructionFiles', removeLLMInstructionsFiles);
}
