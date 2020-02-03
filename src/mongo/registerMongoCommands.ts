/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureTreeItem, callWithTelemetryAndErrorHandling, IActionContext, registerCommand, registerEvent } from "vscode-azureextensionui";
import { CosmosEditorManager } from "../CosmosEditorManager";
import { ext } from "../extensionVariables";
import { AttachedAccountSuffix } from '../tree/AttachedAccountsTreeItem';
import * as vscodeUtil from '../utils/vscodeUtils';
import { MongoCollectionNodeEditor } from "./editors/MongoCollectionNodeEditor";
import { MongoDBLanguageClient } from "./languageClient";
import { executeAllCommandsFromActiveEditor, executeCommandFromActiveEditor, executeCommandFromText, getAllErrorsFromTextDocument } from "./MongoScrapbook";
import { MongoCodeLensProvider } from "./services/MongoCodeLensProvider";
import { MongoAccountTreeItem } from "./tree/MongoAccountTreeItem";
import { MongoCollectionTreeItem } from "./tree/MongoCollectionTreeItem";
import { MongoDatabaseTreeItem } from "./tree/MongoDatabaseTreeItem";
import { MongoDocumentTreeItem } from "./tree/MongoDocumentTreeItem";

const connectedDBKey: string = 'ms-azuretools.vscode-cosmosdb.connectedDB';
let diagnosticsCollection: vscode.DiagnosticCollection;

export function registerMongoCommands(editorManager: CosmosEditorManager): void {
    let languageClient: MongoDBLanguageClient = new MongoDBLanguageClient();

    const codeLensProvider = new MongoCodeLensProvider();
    ext.context.subscriptions.push(vscode.languages.registerCodeLensProvider('mongo', codeLensProvider));

    diagnosticsCollection = vscode.languages.createDiagnosticCollection('cosmosDB.mongo');
    ext.context.subscriptions.push(diagnosticsCollection);

    setUpErrorReporting();

    const loadPersistedMongoDBTask: Promise<void> = loadPersistedMongoDB(languageClient, codeLensProvider);

    registerCommand('cosmosDB.createMongoDatabase', async (context: IActionContext, node?: MongoAccountTreeItem) => {
        if (!node) {
            node = <MongoAccountTreeItem>await ext.tree.showTreeItemPicker([MongoAccountTreeItem.contextValue, MongoAccountTreeItem.contextValue + AttachedAccountSuffix], context);
        }
        const databaseNode = <MongoDatabaseTreeItem>await node.createChild(context);
        // reveal the database treeItem in case user cancels collection creation
        await ext.treeView.reveal(databaseNode, { focus: false });
        const collectionNode = <MongoCollectionTreeItem>await databaseNode.createChild(context);
        await ext.treeView.reveal(collectionNode, { focus: true });

        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', databaseNode);
    });
    registerCommand('cosmosDB.createMongoCollection', async (context: IActionContext, node?: MongoDatabaseTreeItem) => {
        if (!node) {
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue, context);
        }
        const collectionNode = await node.createChild(context);
        await ext.treeView.reveal(collectionNode);
        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', collectionNode.parent);
    });
    registerCommand('cosmosDB.createMongoDocument', async (context: IActionContext, node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = <MongoCollectionTreeItem>await ext.tree.showTreeItemPicker(MongoCollectionTreeItem.contextValue, context);
        }
        const documentNode = await node.createChild(context);
        await ext.treeView.reveal(documentNode);
        await vscode.commands.executeCommand("cosmosDB.openDocument", documentNode);
    });
    registerCommand('cosmosDB.connectMongoDB', async (context: IActionContext, node?: MongoDatabaseTreeItem) => {
        if (!node) {
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue, context);
        }

        const oldNodeId: string | undefined = ext.connectedMongoDB && ext.connectedMongoDB.fullId;
        await languageClient.connect(node.connectionString, node.databaseName);
        ext.context.globalState.update(connectedDBKey, node.fullId);
        setConnectedNode(node, codeLensProvider);
        await node.refresh();

        if (oldNodeId) {
            // We have to use findTreeItem to get the instance of the old node that's being displayed in the ext.tree. Our specific instance might have been out-of-date
            const oldNode: AzureTreeItem | undefined = await ext.tree.findTreeItem(oldNodeId, context);
            if (oldNode) {
                await oldNode.refresh();
            }
        }
    });
    registerCommand('cosmosDB.deleteMongoDB', async (context: IActionContext, node?: MongoDatabaseTreeItem) => {
        if (!node) {
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
        if (ext.connectedMongoDB && ext.connectedMongoDB.fullId === node.fullId) {
            setConnectedNode(undefined, codeLensProvider);
            ext.context.globalState.update(connectedDBKey, undefined);
            languageClient.disconnect();
        }
    });

    registerCommand('cosmosDB.disconnectMongoDB', async (context: IActionContext, node?: MongoDatabaseTreeItem) => {
        if (!node) {
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue, context);
        }

        if (ext.connectedMongoDB && ext.connectedMongoDB.fullId === node.fullId) {
            setConnectedNode(undefined, codeLensProvider);
            await node.refresh();

        }
    });
    // NEW//
    registerCommand('cosmosDB.deleteMongoCollection', async (context: IActionContext, node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = <MongoCollectionTreeItem>await ext.tree.showTreeItemPicker(MongoCollectionTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.deleteMongoDocument', async (context: IActionContext, node?: MongoDocumentTreeItem) => {
        if (!node) {
            node = <MongoDocumentTreeItem>await ext.tree.showTreeItemPicker(MongoDocumentTreeItem.contextValue, context);
        }
        await node.deleteTreeItem(context);
    });
    registerCommand('cosmosDB.openCollection', async (context: IActionContext, node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = <MongoCollectionTreeItem>await ext.tree.showTreeItemPicker(MongoCollectionTreeItem.contextValue, context);
        }
        await editorManager.showDocument(context, new MongoCollectionNodeEditor(node), node.label + '-cosmos-collection.json');
    });
    registerCommand('cosmosDB.launchMongoShell', launchMongoShell);
    registerCommand('cosmosDB.newMongoScrapbook', async () => await vscodeUtil.showNewFile('', 'Scrapbook', '.mongo'));
    registerCommand('cosmosDB.executeMongoCommand', async (context: IActionContext, commandText: object) => {
        await loadPersistedMongoDBTask;
        if (typeof commandText === "string") {
            await executeCommandFromText(ext.connectedMongoDB, editorManager, context, <string>commandText);
        } else {
            await executeCommandFromActiveEditor(ext.connectedMongoDB, editorManager, context);
        }
    });
    registerCommand('cosmosDB.executeAllMongoCommands', async (context: IActionContext) => {
        await loadPersistedMongoDBTask;
        await executeAllCommandsFromActiveEditor(ext.connectedMongoDB, editorManager, context);
    });
}

async function loadPersistedMongoDB(languageClient: MongoDBLanguageClient, codeLensProvider: MongoCodeLensProvider): Promise<void> {
    // NOTE: We want to make sure this function never throws or returns a rejected promise because it gets awaited multiple times
    await callWithTelemetryAndErrorHandling('cosmosDB.loadPersistedMongoDB', async (context: IActionContext) => {
        context.errorHandling.suppressDisplay = true;
        context.telemetry.properties.isActivationEvent = 'true';

        try {
            const persistedNodeId: string | undefined = ext.context.globalState.get(connectedDBKey);
            if (persistedNodeId) {
                const persistedNode = await ext.tree.findTreeItem(persistedNodeId, context);
                if (persistedNode) {
                    await languageClient.client.onReady();
                    await vscode.commands.executeCommand('cosmosDB.connectMongoDB', persistedNode);
                }
            }
        } finally {
            // Get code lens provider out of initializing state if there's no connected DB
            if (!ext.connectedMongoDB) {
                codeLensProvider.setConnectedDatabase(undefined);
            }
        }
    });
}

function launchMongoShell() {
    const terminal: vscode.Terminal = vscode.window.createTerminal('Mongo Shell');
    terminal.sendText(`mongo`);
    terminal.show();
}

function setConnectedNode(node: MongoDatabaseTreeItem | undefined, codeLensProvider: MongoCodeLensProvider) {
    ext.connectedMongoDB = node;
    let dbName = node && node.label;
    console.log(dbName);
    codeLensProvider.setConnectedDatabase(dbName);
}

function setUpErrorReporting() {
    // Update errors immediately in case a scrapbook is already open
    callWithTelemetryAndErrorHandling(
        "initialUpdateErrorsInActiveDocument",
        async (context: IActionContext) => {
            updateErrorsInScrapbook(context, vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
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
            if (isScrapbook(document)) {
                diagnosticsCollection.set(document.uri, []);
            } else {
                context.telemetry.suppressIfSuccessful = true;
            }
        });
}

function isScrapbook(document: vscode.TextDocument): boolean {
    return document && document.languageId === 'mongo';
}

function updateErrorsInScrapbook(context: IActionContext, document: vscode.TextDocument): void {
    if (isScrapbook(document)) {
        let errors = getAllErrorsFromTextDocument(document);
        diagnosticsCollection.set(document.uri, errors);
    } else {
        context.telemetry.suppressIfSuccessful = true;
    }
}
