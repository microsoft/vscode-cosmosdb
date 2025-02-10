/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type IActionContext, registerCommandWithTreeNodeUnwrapping } from '@microsoft/vscode-azext-utils';
import type vscode from 'vscode';
import { doubleClickDebounceDelay } from '../constants';
import { registerDocDBCommands } from '../docdb/registerDocDBCommands';
import { ext } from '../extensionVariables';
import { registerMongoCommands } from '../mongo/registerMongoCommands';
import { registerPostgresCommands } from '../postgres/commands/registerPostgresCommands';
import { attachAccount } from './attachAccount/attachAccount';
import { attachEmulator } from './attachEmulator/attachEmulator';
import { copyAzureConnectionString } from './copyConnectionString/copyConnectionString';
import { createDocumentDBContainer, createGraph } from './createContainer/createContainer';
import { createAzureDatabase } from './createDatabase/createDatabase';
import { createDocumentDBDocument } from './createDocument/createDocument';
import { createServer } from './createServer/createServer';
import { createDocumentDBStoredProcedure } from './createStoredProcedure/createStoredProcedure';
import { createDocumentDBTrigger } from './createTrigger/createTrigger';
import { deleteGraph } from './deleteContainer/deleteContainer';
import { deleteAzureDatabase } from './deleteDatabase/deleteDatabase';
import { deleteAzureDatabaseAccount } from './deleteDatabaseAccount/deleteDatabaseAccount';
import { deleteDocumentDBItem } from './deleteItems/deleteItems';
import { deleteDocumentDBStoredProcedure } from './deleteStoredProcedure/deleteStoredProcedure';
import { deleteDocumentDBTrigger } from './deleteTrigger/deleteTrigger';
import { detachAzureDatabaseAccount } from './detachDatabaseAccount/detachDatabaseAccount';
import { executeDocumentDBStoredProcedure } from './executeStoredProcedure/executeStoredProcedure';
import { importDocuments } from './importDocuments/importDocuments';
import { openDocumentDBItem } from './openDocument/openDocument';
import { openGraphExplorer } from './openGraphExplorer/openGraphExplorer';
import { openNoSqlQueryEditor } from './openNoSqlQueryEditor/openNoSqlQueryEditor';
import { openDocumentDBStoredProcedure } from './openStoredProcedure/openStoredProcedure';
import { openDocumentDBTrigger } from './openTrigger/openTrigger';
import { refreshTreeElement } from './refreshTreeElement/refreshTreeElement';
import { viewDocumentDBContainerOffer, viewDocumentDBDatabaseOffer } from './viewOffer/viewOffer';

/**
 * DISCLAIMER:
 * It does not any matter to which category the command belongs to as long as it is a command.
 * Today it might be a resource group command, tomorrow it might be a subscription command.
 * Therefore, it is better to categorize the command as a command.
 *
 * However, in this file the commands might be categorized using different functions.
 */

export function registerCommands(): void {
    /*[ ]*/ registerCommandWithTreeNodeUnwrapping('azureDatabases.createServer', createServer);

    registerAccountCommands();
    registerDatabaseCommands();
    registerContainerCommands();
    registerDocumentCommands();
    registerStoredProcedureCommands();
    registerTriggerCommands();

    // Scrapbooks and old commands
    registerDocDBCommands();
    registerMongoCommands();
    registerPostgresCommands();

    registerCommandWithTreeNodeUnwrapping('azureDatabases.refresh', refreshTreeElement);

    // For DocumentDB FileSystem (Scrapbook)
    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.update',
        async (_actionContext: IActionContext, uri: vscode.Uri) => await ext.fileSystem.updateWithoutPrompt(uri),
    );
}

export function registerAccountCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDatabase', createAzureDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', deleteAzureDatabaseAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.attachDatabaseAccount', attachAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.attachEmulator', attachEmulator);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.detachDatabaseAccount', detachAzureDatabaseAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', copyAzureConnectionString);
}

export function registerDatabaseCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createGraph', createGraph);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createContainer', createDocumentDBContainer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDatabase', deleteAzureDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.viewDocDBDatabaseOffer', viewDocumentDBDatabaseOffer);
}

export function registerContainerCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openNoSqlQueryEditor', openNoSqlQueryEditor);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.importDocument', importDocuments);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteGraph', deleteGraph);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBContainer', deleteAzureDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.viewDocDBContainerOffer', viewDocumentDBContainerOffer);
}

export function registerDocumentCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBDocument', createDocumentDBDocument);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openGraphExplorer', openGraphExplorer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openDocument', openDocumentDBItem, doubleClickDebounceDelay);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBDocument', deleteDocumentDBItem);
}

export function registerStoredProcedureCommands() {
    registerCommandWithTreeNodeUnwrapping(
        'cosmosDB.openStoredProcedure',
        openDocumentDBStoredProcedure,
        doubleClickDebounceDelay,
    );
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBStoredProcedure', createDocumentDBStoredProcedure);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.executeDocDBStoredProcedure', executeDocumentDBStoredProcedure);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBStoredProcedure', deleteDocumentDBStoredProcedure);
}

export function registerTriggerCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDocDBTrigger', createDocumentDBTrigger);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openTrigger', openDocumentDBTrigger, doubleClickDebounceDelay);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBTrigger', deleteDocumentDBTrigger);
}
