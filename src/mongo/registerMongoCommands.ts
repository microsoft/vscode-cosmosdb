/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    IActionContext,
    IErrorHandlerContext,
    registerCommandWithTreeNodeUnwrapping,
    registerErrorHandler,
    registerEvent,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { connectMongoDatabase, loadPersistedMongoDB } from './commands/connectMongoDatabase';
import { createMongoCollection } from './commands/createMongoCollection';
import { createMongoDatabase } from './commands/createMongoDatabase';
import { createMongoDocument } from './commands/createMongoDocument';
import { createMongoSrapbook } from './commands/createMongoScrapbook';
import { deleteMongoCollection } from './commands/deleteMongoCollection';
import { deleteMongoDB } from './commands/deleteMongoDatabase';
import { deleteMongoDocument } from './commands/deleteMongoDocument';
import { executeAllMongoCommand } from './commands/executeAllMongoCommand';
import { executeMongoCommand } from './commands/executeMongoCommand';
import { launchMongoShell } from './commands/launchMongoShell';
import { openMongoCollection } from './commands/openMongoCollection';
import { MongoConnectError } from './connectToMongoClient';
import { MongoDBLanguageClient } from './languageClient';
import { getAllErrorsFromTextDocument } from './MongoScrapbook';
import { MongoCodeLensProvider } from './services/MongoCodeLensProvider';

let diagnosticsCollection: vscode.DiagnosticCollection;
const mongoLanguageId: string = 'mongo';

export function registerMongoCommands(): void {
    ext.mongoLanguageClient = new MongoDBLanguageClient();

    ext.mongoCodeLensProvider = new MongoCodeLensProvider();
    ext.context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(mongoLanguageId, ext.mongoCodeLensProvider),
    );

    diagnosticsCollection = vscode.languages.createDiagnosticCollection('cosmosDB.mongo');
    ext.context.subscriptions.push(diagnosticsCollection);

    setUpErrorReporting();
    void loadPersistedMongoDB();

    registerCommandWithTreeNodeUnwrapping('cosmosDB.launchMongoShell', launchMongoShell);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.newMongoScrapbook', createMongoSrapbook);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.executeMongoCommand', executeMongoCommand);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.executeAllMongoCommands', executeAllMongoCommand);

    // #region Account command

    registerCommandWithTreeNodeUnwrapping('cosmosDB.createMongoDatabase', createMongoDatabase);

    // #endregion

    // #region Database command

    registerCommandWithTreeNodeUnwrapping('cosmosDB.connectMongoDB', connectMongoDatabase);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createMongoCollection', createMongoCollection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteMongoDB', deleteMongoDB);

    // #endregion

    // #region Collection command

    registerCommandWithTreeNodeUnwrapping('cosmosDB.openCollection', openMongoCollection);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.createMongoDocument', createMongoDocument);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteMongoCollection', deleteMongoCollection);

    // #endregion

    // #region Document command

    registerCommandWithTreeNodeUnwrapping('cosmosDB.deleteMongoDocument', deleteMongoDocument);

    // #endregion
}

function setUpErrorReporting(): void {
    // Update errors immediately in case a scrapbook is already open
    void callWithTelemetryAndErrorHandling('initialUpdateErrorsInActiveDocument', async (context: IActionContext) => {
        updateErrorsInScrapbook(context, vscode.window.activeTextEditor?.document);
    });

    // Update errors when document opened/changed
    registerEvent(
        'vscode.workspace.onDidOpenTextDocument',
        vscode.workspace.onDidOpenTextDocument,
        updateErrorsInScrapbook,
    );
    registerEvent(
        'vscode.workspace.onDidChangeTextDocument',
        vscode.workspace.onDidChangeTextDocument,
        async (context: IActionContext, event: vscode.TextDocumentChangeEvent) => {
            // Always suppress success telemetry - event happens on every keystroke
            context.telemetry.suppressIfSuccessful = true;

            updateErrorsInScrapbook(context, event.document);
        },
    );
    registerEvent(
        'vscode.workspace.onDidCloseTextDocument',
        vscode.workspace.onDidCloseTextDocument,
        async (context: IActionContext, document: vscode.TextDocument) => {
            // Remove errors when closed
            if (document?.languageId === mongoLanguageId) {
                diagnosticsCollection.set(document.uri, []);
            } else {
                context.telemetry.suppressIfSuccessful = true;
            }
        },
    );

    registerErrorHandler((context: IErrorHandlerContext) => {
        if (context.error instanceof MongoConnectError) {
            context.errorHandling.suppressReportIssue = true;
        }
    });
}

function updateErrorsInScrapbook(context: IActionContext, document: vscode.TextDocument | undefined): void {
    if (document?.languageId === mongoLanguageId) {
        const errors = getAllErrorsFromTextDocument(document);
        diagnosticsCollection.set(document.uri, errors);
    } else {
        context.telemetry.suppressIfSuccessful = true;
    }
}
