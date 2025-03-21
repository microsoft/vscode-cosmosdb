/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    callWithTelemetryAndErrorHandling,
    registerCommandWithTreeNodeUnwrapping,
    registerErrorHandler,
    registerEvent,
    type IActionContext,
    type IErrorHandlerContext,
} from '@microsoft/vscode-azext-utils';
import * as vscode from 'vscode';
import { connectMongoDatabase } from '../commands/scrapbook-commands/connectMongoDatabase';
import { createMongoScrapbook } from '../commands/scrapbook-commands/createMongoScrapbook';
import { executeAllMongoCommand } from '../commands/scrapbook-commands/executeAllMongoCommand';
import { executeMongoCommand } from '../commands/scrapbook-commands/executeMongoCommand';
import { ext } from '../extensionVariables';
import { MongoConnectError } from './scrapbook/connectToMongoClient';
import { MongoDBLanguageClient } from './scrapbook/languageClient';
import { getAllErrorsFromTextDocument } from './scrapbook/MongoScrapbookHelpers';
import { MongoScrapbookService } from './scrapbook/MongoScrapbookService';

let diagnosticsCollection: vscode.DiagnosticCollection;
const mongoLanguageId: string = 'mongo';

export function registerMongoCommands(): void {
    ext.mongoLanguageClient = new MongoDBLanguageClient();

    ext.context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(mongoLanguageId, MongoScrapbookService.getCodeLensProvider()),
    );

    diagnosticsCollection = vscode.languages.createDiagnosticCollection('cosmosDB.mongo');
    ext.context.subscriptions.push(diagnosticsCollection);

    setUpErrorReporting();

    registerCommandWithTreeNodeUnwrapping('cosmosDB.newMongoScrapbook', createMongoScrapbook);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.executeMongoCommand', executeMongoCommand);
    registerCommandWithTreeNodeUnwrapping('cosmosDB.executeAllMongoCommands', executeAllMongoCommand);

    // #region Database command

    registerCommandWithTreeNodeUnwrapping('cosmosDB.connectMongoDB', connectMongoDatabase);

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
