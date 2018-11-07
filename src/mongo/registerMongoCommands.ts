/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureTreeItem, callWithTelemetryAndErrorHandling, IActionContext, registerCommand, registerEvent } from "vscode-azureextensionui";
import { CosmosEditorManager } from "../CosmosEditorManager";
import { ext } from "../extensionVariables";
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

export function registerMongoCommands(context: vscode.ExtensionContext, editorManager: CosmosEditorManager): void {
    let languageClient: MongoDBLanguageClient = new MongoDBLanguageClient(context);

    const codeLensProvider = new MongoCodeLensProvider();
    context.subscriptions.push(vscode.languages.registerCodeLensProvider('mongo', codeLensProvider));

    diagnosticsCollection = vscode.languages.createDiagnosticCollection('cosmosDB.mongo');
    context.subscriptions.push(diagnosticsCollection);

    setUpErrorReporting();

    const loadPersistedMongoDBTask: Promise<void> = loadPersistedMongoDB(context, languageClient, codeLensProvider);

    registerCommand('cosmosDB.createMongoDatabase', async (node?: MongoAccountTreeItem) => {
        if (!node) {
            node = <MongoAccountTreeItem>await ext.tree.showTreeItemPicker(MongoAccountTreeItem.contextValue);
        }
        const databaseNode = <MongoDatabaseTreeItem>await node.createChild();
        // reveal the database treeItem in case user cancels collection creation
        await ext.treeView.reveal(databaseNode, { focus: false });
        const collectionNode = <MongoCollectionTreeItem>await databaseNode.createChild();
        await ext.treeView.reveal(collectionNode, { focus: true });

        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', databaseNode);
    });
    registerCommand('cosmosDB.createMongoCollection', async (node?: MongoDatabaseTreeItem) => {
        if (!node) {
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue);
        }
        const collectionNode = await node.createChild();
        await ext.treeView.reveal(collectionNode);
        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', collectionNode.parent);
    });
    registerCommand('cosmosDB.createMongoDocument', async (node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = <MongoCollectionTreeItem>await ext.tree.showTreeItemPicker(MongoCollectionTreeItem.contextValue);
        }
        const documentNode = await node.createChild();
        await ext.treeView.reveal(documentNode);
        await vscode.commands.executeCommand("cosmosDB.openDocument", documentNode);
    });
    registerCommand('cosmosDB.connectMongoDB', async (node?: MongoDatabaseTreeItem) => {
        if (!node) {
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue);
        }

        const oldNodeId: string | undefined = ext.connectedMongoDB && ext.connectedMongoDB.fullId;
        await languageClient.connect(node.connectionString, node.databaseName);
        context.globalState.update(connectedDBKey, node.fullId);
        setConnectedNode(node, codeLensProvider);
        await node.refresh();

        if (oldNodeId) {
            // We have to use findTreeItem to get the instance of the old node that's being displayed in the ext.tree. Our specific instance might have been out-of-date
            const oldNode: AzureTreeItem | undefined = await ext.tree.findTreeItem(oldNodeId);
            if (oldNode) {
                await oldNode.refresh();
            }
        }
    });
    registerCommand('cosmosDB.deleteMongoDB', async (node?: MongoDatabaseTreeItem) => {
        if (!node) {
            node = <MongoDatabaseTreeItem>await ext.tree.showTreeItemPicker(MongoDatabaseTreeItem.contextValue);
        }
        await node.deleteTreeItem();
        if (ext.connectedMongoDB && ext.connectedMongoDB.fullId === node.fullId) {
            setConnectedNode(undefined, codeLensProvider);
            context.globalState.update(connectedDBKey, undefined);
            languageClient.disconnect();
        }
    });
    registerCommand('cosmosDB.deleteMongoCollection', async (node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = <MongoCollectionTreeItem>await ext.tree.showTreeItemPicker(MongoCollectionTreeItem.contextValue);
        }
        await node.deleteTreeItem();
    });
    registerCommand('cosmosDB.deleteMongoDocument', async (node?: MongoDocumentTreeItem) => {
        if (!node) {
            node = <MongoDocumentTreeItem>await ext.tree.showTreeItemPicker(MongoDocumentTreeItem.contextValue);
        }
        await node.deleteTreeItem();
    });
    registerCommand('cosmosDB.openCollection', async (node?: MongoCollectionTreeItem) => {
        if (!node) {
            node = <MongoCollectionTreeItem>await ext.tree.showTreeItemPicker(MongoCollectionTreeItem.contextValue);
        }
        await editorManager.showDocument(new MongoCollectionNodeEditor(node), node.label + '-cosmos-collection.json');
    });
    registerCommand('cosmosDB.launchMongoShell', launchMongoShell);
    registerCommand('cosmosDB.newMongoScrapbook', async () => await vscodeUtil.showNewFile('', context.extensionPath, 'Scrapbook', '.mongo'));
    registerCommand('cosmosDB.executeMongoCommand', async function (this: IActionContext, commandText: object) {
        await loadPersistedMongoDBTask;
        if (typeof commandText === "string") {
            await executeCommandFromText(ext.connectedMongoDB, context.extensionPath, editorManager, this, <string>commandText);
        } else {
            await executeCommandFromActiveEditor(ext.connectedMongoDB, context.extensionPath, editorManager, this);
        }
    });
    registerCommand('cosmosDB.executeAllMongoCommands', async function (this: IActionContext) {
        await loadPersistedMongoDBTask;
        await executeAllCommandsFromActiveEditor(ext.connectedMongoDB, context.extensionPath, editorManager, this);
    });
}

async function loadPersistedMongoDB(context: vscode.ExtensionContext, languageClient: MongoDBLanguageClient, codeLensProvider: MongoCodeLensProvider): Promise<void> {
    // NOTE: We want to make sure this function never throws or returns a rejected promise because it gets awaited multiple times
    await callWithTelemetryAndErrorHandling('cosmosDB.loadPersistedMongoDB', async function (this: IActionContext): Promise<void> {
        this.suppressErrorDisplay = true;
        this.properties.isActivationEvent = 'true';

        try {
            const persistedNodeId: string | undefined = context.globalState.get(connectedDBKey);
            if (persistedNodeId) {
                const persistedNode = await ext.tree.findTreeItem(persistedNodeId);
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
    codeLensProvider.setConnectedDatabase(dbName);
}

function setUpErrorReporting() {
    // Update errors immediately in case a scrapbook is already open
    callWithTelemetryAndErrorHandling(
        "initialUpdateErrorsInActiveDocument",
        async function (this: IActionContext): Promise<void> {
            updateErrorsInScrapbook(this, vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
        });

    // Update errors when document opened/changed
    registerEvent(
        'vscode.workspace.onDidOpenTextDocument',
        vscode.workspace.onDidOpenTextDocument,
        async function (this: IActionContext, document: vscode.TextDocument) {
            updateErrorsInScrapbook(this, document);
        });
    registerEvent(
        'vscode.workspace.onDidChangeTextDocument',
        vscode.workspace.onDidChangeTextDocument,
        async function (this: IActionContext, event: vscode.TextDocumentChangeEvent) {
            // Always suppress success telemetry - event happens on every keystroke
            this.suppressTelemetry = true;

            updateErrorsInScrapbook(this, event.document);
        });
    registerEvent(
        'vscode.workspace.onDidCloseTextDocument',
        vscode.workspace.onDidCloseTextDocument,
        async function (this: IActionContext, document: vscode.TextDocument) {
            // Remove errors when closed
            if (isScrapbook(document)) {
                diagnosticsCollection.set(document.uri, []);
            } else {
                this.suppressTelemetry = true;
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
        context.suppressTelemetry = true;
    }
}
