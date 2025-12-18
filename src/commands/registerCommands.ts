/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    type IActionContext,
    registerCommand,
    registerCommandWithTreeNodeUnwrapping,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { doubleClickDebounceDelay } from '../constants';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import {
    deployLLMInstructionsFiles,
    removeLLMInstructionsFiles,
} from '../cosmosdb/commands/deployLLMInstructionsFiles';
import { registerCosmosDBCommands } from '../cosmosdb/registerCosmosDBCommands';
import { ext } from '../extensionVariables';
import { QueryEditorTab } from '../panels/QueryEditorTab';
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
import { filterTreeItems } from './filterTreeItems/filterTreeItems';
import { importDocuments } from './importDocuments/importDocuments';
import { cosmosDBLoadMore } from './loadMore/loadMore';
import { newConnection } from './newConnection/newConnection';
import { newEmulatorConnection } from './newEmulatorConnection/newEmulatorConnection';
import { cosmosDBOpenItem } from './openDocument/openDocument';
import { cosmosDBOpenGraphExplorer } from './openGraphExplorer/cosmosDBOpenGraphExplorer';
import { openNoSqlQueryEditor } from './openNoSqlQueryEditor/openNoSqlQueryEditor';
import { cosmosDBOpenStoredProcedure } from './openStoredProcedure/openStoredProcedure';
import { cosmosDBOpenTrigger } from './openTrigger/openTrigger';
import { openUnsupportedAccount } from './openUnsupportedAccount/openUnsupportedAccount';
import { refreshTreeElement } from './refreshTreeElement/refreshTreeElement';
import { removeConnection } from './removeConnection/removeConnection';
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

    // old commands
    registerCosmosDBCommands();
    registerPostgresCommands();

    registerCommandWithTreeNodeUnwrapping('azureDatabases.refresh', refreshTreeElement);

    // For Cosmos DB FileSystem (Scrapbook)
    registerCommandWithTreeNodeUnwrapping(
        'azureDatabases.update',
        async (_actionContext: IActionContext, uri: vscode.Uri) => await ext.fileSystem.updateWithoutPrompt(uri),
    );

    registerCommandWithTreeNodeUnwrapping('azureDatabases.filterTreeItems', filterTreeItems);
    registerCommandWithTreeNodeUnwrapping('azureDatabases.sortTreeItems', sortTreeItems);

    registerLLMAssetsCommands();
    registerChatButtonCommands();
}

export function registerAccountCommands() {
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createDatabase', createAzureDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteAccount', deleteAzureDatabaseAccount);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.newConnection', newConnection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.newEmulatorConnection', newEmulatorConnection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.removeConnection', removeConnection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.copyConnectionString', copyAzureConnectionString);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.openUnsupportedAccount', openUnsupportedAccount);
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

export function registerLLMAssetsCommands() {
    registerCommand('cosmosDB.ai.deployInstructionFiles', deployLLMInstructionsFiles);
    registerCommand('cosmosDB.ai.removeInstructionFiles', removeLLMInstructionsFiles);
}

export function registerChatButtonCommands() {
    // Command to apply the suggested query (update current editor)
    // Note: Chat buttons pass arguments directly, so we use vscode.commands.registerCommand
    // to avoid the IActionContext injection from registerCommand
    ext.context.subscriptions.push(
        vscode.commands.registerCommand(
            'cosmosDB.applyQuerySuggestion',
            async (connection: NoSqlQueryConnection, suggestedQuery: string) => {
                console.log('[CosmosDB Chat] applyQuerySuggestion called', { connection, suggestedQuery });

                if (!connection || !suggestedQuery) {
                    void vscode.window.showErrorMessage('Missing connection or query data');
                    return;
                }

                // Find the active query editor tab and update its query
                const activeQueryEditors = Array.from(QueryEditorTab.openTabs);
                const activeTab = activeQueryEditors.find(
                    (tab) =>
                        tab.getConnection()?.endpoint === connection.endpoint &&
                        tab.getConnection()?.databaseId === connection.databaseId &&
                        tab.getConnection()?.containerId === connection.containerId,
                );

                if (activeTab && 'updateQuery' in activeTab) {
                    // Update the query in the existing webview
                    await activeTab.updateQuery(suggestedQuery);
                    void vscode.window.showInformationMessage('✅ Query updated successfully!');
                } else {
                    // Fallback: create a new tab if no matching tab is found
                    QueryEditorTab.render(connection, vscode.ViewColumn.Active, false, suggestedQuery);
                    void vscode.window.showInformationMessage('✅ Query opened in new tab!');
                }
            },
        ),
    );

    // Command to open query side-by-side
    ext.context.subscriptions.push(
        vscode.commands.registerCommand(
            'cosmosDB.openQuerySideBySide',
            (connection: NoSqlQueryConnection, suggestedQuery: string) => {
                console.log('[CosmosDB Chat] openQuerySideBySide called', { connection, suggestedQuery });

                if (!connection || !suggestedQuery) {
                    void vscode.window.showErrorMessage('Missing connection or query data');
                    return;
                }

                QueryEditorTab.render(connection, vscode.ViewColumn.Two, false, suggestedQuery);
                void vscode.window.showInformationMessage('🔍 Suggested query opened side-by-side for comparison.');
            },
        ),
    );
}
