/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzExtTreeItem, callWithTelemetryAndErrorHandling, IActionContext, IErrorHandlerContext, ITreeItemPickerContext, registerCommand, registerErrorHandler, registerEvent } from "@microsoft/vscode-azext-utils";
import * as vscode from 'vscode';
import { Experience, MongoExperience } from '../AzureDBExperiences';
import { cosmosMongoFilter } from "../constants";
import { ext } from "../extensionVariables";
import * as vscodeUtil from '../utils/vscodeUtils';
import { MongoConnectError } from './connectToMongoClient';
import { MongoDBLanguageClient } from "./languageClient";
import { executeAllCommandsFromActiveEditor, executeCommandFromActiveEditor, getAllErrorsFromTextDocument } from "./MongoScrapbook";
import { MongoCodeLensProvider } from "./services/MongoCodeLensProvider";
import { setConnectedNode } from "./setConnectedNode";
import { MongoAccountTreeItem } from "./tree/MongoAccountTreeItem";
import { MongoCollectionTreeItem } from "./tree/MongoCollectionTreeItem";
import { MongoDatabaseTreeItem } from "./tree/MongoDatabaseTreeItem";
import { MongoDocumentTreeItem } from "./tree/MongoDocumentTreeItem";

const connectedMongoKey: string = 'ms-azuretools.vscode-cosmosdb.connectedDB';
let diagnosticsCollection: vscode.DiagnosticCollection;
const mongoLanguageId: string = 'mongo';

export function registerMongoCommands(): void {
    ext.mongoLanguageClient = new MongoDBLanguageClient();

    ext.mongoCodeLensProvider = new MongoCodeLensProvider();
    ext.context.subscriptions.push(vscode.languages.registerCodeLensProvider(mongoLanguageId, ext.mongoCodeLensProvider));

    diagnosticsCollection = vscode.languages.createDiagnosticCollection('cosmosDB.mongo');
    ext.context.subscriptions.push(diagnosticsCollection);

    setUpErrorReporting();

    const loadPersistedMongoDBTask: Promise<void> = loadPersistedMongoDB();

    registerCommand('cosmosDB.createMongoDatabase', createMongoDatabase);
    registerCommand('cosmosDB.createMongoCollection', createMongoCollection);
    registerCommand('cosmosDB.createMongoDocument', async (context: IActionContext, node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = await pickMongo<MongoCollectionTreeItem>(context, MongoCollectionTreeItem.contextValue);
        }
        const documentNode = await node.createChild(context);
        await vscode.commands.executeCommand("cosmosDB.openDocument", documentNode);
    });
    registerCommand('cosmosDB.connectMongoDB', async (context: IActionContext, node?: MongoDatabaseTreeItem) => {
        if (!node) {
            // Include defaultExperience in the context to prevent https://github.com/microsoft/vscode-cosmosdb/issues/1517
            const experienceContext: ITreeItemPickerContext & { defaultExperience?: Experience } = { ...context, defaultExperience: MongoExperience };
            node = await pickMongo<MongoDatabaseTreeItem>(experienceContext, MongoDatabaseTreeItem.contextValue);
        }

        const oldNodeId: string | undefined = ext.connectedMongoDB && ext.connectedMongoDB.fullId;
        await ext.mongoLanguageClient.connect(node.connectionString, node.databaseName);
        void ext.context.globalState.update(connectedMongoKey, node.fullId);
        setConnectedNode(node);
        await node.refresh(context);

        if (oldNodeId) {
            // We have to use findTreeItem to get the instance of the old node that's being displayed in the ext.rgApi.appResourceTree. Our specific instance might have been out-of-date
            const oldNode: AzExtTreeItem | undefined = await ext.rgApi.appResourceTree.findTreeItem(oldNodeId, context);
            if (oldNode) {
                await oldNode.refresh(context);
            }
        }
    });
    registerCommand('cosmosDB.deleteMongoDB', deleteMongoDB);
    registerCommand('cosmosDB.deleteMongoCollection', deleteMongoCollection);
    registerCommand('cosmosDB.deleteMongoDocument', async (context: IActionContext, node?: MongoDocumentTreeItem) => {
        const suppressCreateContext: ITreeItemPickerContext = context;
        suppressCreateContext.suppressCreatePick = true;
        if (!node) {
            node = await pickMongo<MongoDocumentTreeItem>(context, MongoDocumentTreeItem.contextValue);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.openCollection', async (context: IActionContext, node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = await pickMongo<MongoCollectionTreeItem>(context, MongoCollectionTreeItem.contextValue);
        }
        await ext.fileSystem.showTextDocument(node);
    });
    registerCommand('cosmosDB.launchMongoShell', launchMongoShell);
    registerCommand('cosmosDB.newMongoScrapbook', async () => await vscodeUtil.showNewFile('', 'Scrapbook', '.mongo'));
    registerCommand('cosmosDB.executeMongoCommand', async (context: IActionContext, position?: vscode.Position) => {
        await loadPersistedMongoDBTask;
        await executeCommandFromActiveEditor(context, position);
    });
    registerCommand('cosmosDB.executeAllMongoCommands', async (context: IActionContext) => {
        await loadPersistedMongoDBTask;
        await executeAllCommandsFromActiveEditor(context);
    });
}

async function loadPersistedMongoDB(): Promise<void> {
    // NOTE: We want to make sure this function never throws or returns a rejected promise because it gets awaited multiple times
    await callWithTelemetryAndErrorHandling('cosmosDB.loadPersistedMongoDB', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.isActivationEvent = 'true';

        try {
            const persistedNodeId: string | undefined = ext.context.globalState.get(connectedMongoKey);
            if (persistedNodeId) {
                const persistedNode = await ext.rgApi.appResourceTree.findTreeItem(persistedNodeId, context);
                if (persistedNode) {
                    await ext.mongoLanguageClient.client.onReady();
                    await vscode.commands.executeCommand('cosmosDB.connectMongoDB', persistedNode);
                }
            }
        } finally {
            // Get code lens provider out of initializing state if there's no connected DB
            if (!ext.connectedMongoDB) {
                ext.mongoCodeLensProvider.setConnectedDatabase(undefined);
            }
        }
    });
}

function launchMongoShell(): void {
    const terminal: vscode.Terminal = vscode.window.createTerminal('Mongo Shell');
    terminal.sendText(`mongo`);
    terminal.show();
}

function setUpErrorReporting(): void {
    // Update errors immediately in case a scrapbook is already open
    void callWithTelemetryAndErrorHandling(
        "initialUpdateErrorsInActiveDocument",
        async (context: IActionContext) => {
            updateErrorsInScrapbook(context, vscode.window.activeTextEditor?.document);
        });

    // Update errors when document opened/changed
    registerEvent('vscode.workspace.onDidOpenTextDocument', vscode.workspace.onDidOpenTextDocument, updateErrorsInScrapbook);
    registerEvent(
        'vscode.workspace.onDidChangeTextDocument',
        vscode.workspace.onDidChangeTextDocument,
        async (context: IActionContext, event: vscode.TextDocumentChangeEvent) => {
            // Always suppress success telemetry - event happens on every keystroke
            context.telemetry.suppressIfSuccessful = true;

            updateErrorsInScrapbook(context, event.document);
        });
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
        });

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

export async function createMongoDatabase(context: IActionContext, node?: MongoAccountTreeItem): Promise<void> {
    if (!node) {
        node = await pickMongo<MongoAccountTreeItem>(context);
    }
    const databaseNode = <MongoDatabaseTreeItem>await node.createChild(context);
    await databaseNode.createChild(context);

    await vscode.commands.executeCommand('cosmosDB.connectMongoDB', databaseNode);
}

export async function createMongoCollection(context: IActionContext, node?: MongoDatabaseTreeItem): Promise<void> {
    if (!node) {
        node = await pickMongo<MongoDatabaseTreeItem>(context, MongoDatabaseTreeItem.contextValue);
    }
    const collectionNode = await node.createChild(context);
    await vscode.commands.executeCommand('cosmosDB.connectMongoDB', collectionNode.parent);
}

export async function deleteMongoDB(context: IActionContext, node?: MongoDatabaseTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickMongo<MongoDatabaseTreeItem>(context, MongoDatabaseTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
    if (ext.connectedMongoDB && ext.connectedMongoDB.fullId === node.fullId) {
        setConnectedNode(undefined);
        void ext.context.globalState.update(connectedMongoKey, undefined);
        // Temporary workaround for https://github.com/microsoft/vscode-cosmosdb/issues/1754
        void ext.mongoLanguageClient.disconnect();
    }
}

export async function deleteMongoCollection(context: IActionContext, node?: MongoCollectionTreeItem): Promise<void> {
    const suppressCreateContext: ITreeItemPickerContext = context;
    suppressCreateContext.suppressCreatePick = true;
    if (!node) {
        node = await pickMongo<MongoCollectionTreeItem>(context, MongoCollectionTreeItem.contextValue);
    }
    await node.deleteTreeItem(context);
}

async function pickMongo<T extends AzExtTreeItem>(context: IActionContext, expectedContextValue?: string | RegExp | (string | RegExp)[]): Promise<T> {
    return await ext.rgApi.pickAppResource<T>(context, {
        filter: [
            cosmosMongoFilter
        ],
        expectedChildContextValue: expectedContextValue
    });
}
