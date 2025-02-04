/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type AzExtTreeItem,
    type IActionContext,
    registerCommandWithTreeNodeUnwrapping,
} from '@microsoft/vscode-azext-utils';
import vscode from 'vscode';
import { doubleClickDebounceDelay } from '../constants';
import { registerDocDBCommands } from '../docdb/registerDocDBCommands';
import { type DocDBCollectionTreeItem } from '../docdb/tree/DocDBCollectionTreeItem';
import { ext } from '../extensionVariables';
import { registerMongoCommands } from '../mongo/registerMongoCommands';
import { registerPostgresCommands } from '../postgres/commands/registerPostgresCommands';
import { attachAccount } from './attachAccount/attachAccount';
import { attachEmulator } from './attachEmulator/attachEmulator';
import { copyAzureConnectionString } from './copyConnectionString/copyConnectionString';
import { createDocumentDBContainer, createGraph } from './createContainer/createContainer';
import { createAzureDatabase } from './createDatabase/createDatabase';
import { createServer } from './createServer/createServer';
import { deleteGraph } from './deleteContainer/deleteContainer';
import { deleteAzureDatabase } from './deleteDatabase/deleteDatabase';
import { deleteAzureDatabaseAccount } from './deleteDatabaseAccount/deleteDatabaseAccount';
import { deleteDocumentDBItem } from './deleteItems/deleteItems';
import { deleteDocumentDBStoredProcedure } from './deleteStoredProcedure/deleteStoredProcedure';
import { deleteDocumentDBTrigger } from './deleteTrigger/deleteTrigger';
import { detachAzureDatabaseAccount } from './detachDatabaseAccount/detachDatabaseAccount';
import { importDocuments } from './importDocuments';
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

    registerDocDBCommands();
    registerMongoCommands();
    registerPostgresCommands();

    registerCommandWithTreeNodeUnwrapping('azureDatabases.refresh', refreshTreeElement);

    /*[ ]*/ registerCommandWithTreeNodeUnwrapping(
        'cosmosDB.importDocument',
        async (
            actionContext: IActionContext,
            selectedNode: vscode.Uri | DocDBCollectionTreeItem,
            uris: vscode.Uri[],
        ) => {
            if (selectedNode instanceof vscode.Uri) {
                await importDocuments(actionContext, uris || [selectedNode], undefined);
            } else {
                await importDocuments(actionContext, undefined, selectedNode);
            }
        },
    );

    /*[ ]*/ registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.update',
        async (_actionContext: IActionContext, uri: vscode.Uri) => await ext.fileSystem.updateWithoutPrompt(uri),
    );
    // For Postgres
    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.loadMore',
        async (actionContext: IActionContext, node: AzExtTreeItem) =>
            await ext.rgApi.appResourceTree.loadMore(node, actionContext),
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
    /*[ ]*/ registerCommandWithTreeNodeUnwrapping('cosmosDB.importDocument', () => {});
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteGraph', deleteGraph);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBContainer', deleteAzureDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.viewDocDBContainerOffer', viewDocumentDBContainerOffer);
}

export function registerDocumentCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openGraphExplorer', openGraphExplorer);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBDocument', deleteDocumentDBItem);
}

export function registerStoredProcedureCommands() {
    registerCommandWithTreeNodeUnwrapping(
        'cosmosDB.openStoredProcedure',
        openDocumentDBStoredProcedure,
        doubleClickDebounceDelay,
    );
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBStoredProcedure', deleteDocumentDBStoredProcedure);
}

export function registerTriggerCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openTrigger', openDocumentDBTrigger, doubleClickDebounceDelay);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteDocDBTrigger', deleteDocumentDBTrigger);
}
