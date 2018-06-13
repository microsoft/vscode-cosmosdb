/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeUtils from "../utils/vscodeUtils";
import { AzureActionHandler, IAzureParentNode, AzureTreeDataProvider, IAzureNode, IActionContext, callWithTelemetryAndErrorHandling } from "vscode-azureextensionui";
import * as vscode from 'vscode';
import { MongoCollectionTreeItem } from "./tree/MongoCollectionTreeItem";
import { MongoDatabaseTreeItem } from "./tree/MongoDatabaseTreeItem";
import { MongoAccountTreeItem } from "./tree/MongoAccountTreeItem";
import MongoDBLanguageClient from "./languageClient";
import * as vscodeUtil from '../utils/vscodeUtils';
import { MongoDocumentTreeItem } from "./tree/MongoDocumentTreeItem";
import { MongoCollectionNodeEditor } from "./editors/MongoCollectionNodeEditor";
import { CosmosEditorManager } from "../CosmosEditorManager";
import { reporter } from "../utils/telemetry";
import { MongoCodeLensProvider } from "./services/MongoCodeLensProvider";
import { ext } from "../extensionVariables";
import { executeCommandFromText, executeCommandFromActiveEditor, executeAllCommandsFromActiveEditor, getAllErrorsFromTextDocument } from "./MongoScrapbook";
import TelemetryReporter from "vscode-extension-telemetry";

const connectedDBKey: string = 'ms-azuretools.vscode-cosmosdb.connectedDB';
let diagnosticsCollection: vscode.DiagnosticCollection;

export function registerMongoCommands(context: vscode.ExtensionContext, actionHandler: AzureActionHandler, tree: AzureTreeDataProvider, editorManager: CosmosEditorManager): void {
    let languageClient: MongoDBLanguageClient = new MongoDBLanguageClient(context);

    const codeLensProvider = new MongoCodeLensProvider(reporter, vscodeUtil.getOutputChannel());
    context.subscriptions.push(vscode.languages.registerCodeLensProvider('mongo', codeLensProvider));

    diagnosticsCollection = vscode.languages.createDiagnosticCollection('cosmosDB.mongo');
    context.subscriptions.push(diagnosticsCollection);

    let output = vscodeUtils.getOutputChannel();
    let handler = new AzureActionHandler(context, output, reporter);

    setUpErrorReporting(handler, reporter, output);

    const loadPersistedMongoDBTask: Promise<void> = loadPersistedMongoDB(context, tree, languageClient, codeLensProvider);

    actionHandler.registerCommand('cosmosDB.createMongoDatabase', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(MongoAccountTreeItem.contextValue);
        }
        const childNode = await node.createChild();
        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode);
    });
    actionHandler.registerCommand('cosmosDB.createMongoCollection', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(MongoDatabaseTreeItem.contextValue);
        }
        const childNode = await node.createChild();
        await vscode.commands.executeCommand('cosmosDB.connectMongoDB', childNode.parent);
    });
    actionHandler.registerCommand('cosmosDB.createMongoDocument', async (node?: IAzureParentNode) => {
        if (!node) {
            node = <IAzureParentNode>await tree.showNodePicker(MongoCollectionTreeItem.contextValue);
        }
        let childNode = await node.createChild();
        await vscode.commands.executeCommand("cosmosDB.openDocument", childNode);
    });
    actionHandler.registerCommand('cosmosDB.connectMongoDB', async (node?: IAzureParentNode<MongoDatabaseTreeItem>) => {
        if (!node) {
            node = <IAzureParentNode<MongoDatabaseTreeItem>>await tree.showNodePicker(MongoDatabaseTreeItem.contextValue);
        }

        const oldNodeId: string | undefined = ext.connectedMongoDB && ext.connectedMongoDB.id;
        await languageClient.connect(node.treeItem.connectionString, node.treeItem.databaseName);
        context.globalState.update(connectedDBKey, node.id);
        setConnectedNode(node, codeLensProvider);
        await node.refresh();

        if (oldNodeId) {
            // We have to use findNode to get the instance of the old node that's being displayed in the tree. Our specific instance might have been out-of-date
            const oldNode: IAzureNode | undefined = await tree.findNode(oldNodeId);
            if (oldNode) {
                await oldNode.refresh();
            }
        }
    });
    actionHandler.registerCommand('cosmosDB.deleteMongoDB', async (node?: IAzureNode<MongoDatabaseTreeItem>) => {
        if (!node) {
            node = <IAzureNode<MongoDatabaseTreeItem>>await tree.showNodePicker(MongoDatabaseTreeItem.contextValue);
        }
        await node.deleteNode();
        if (ext.connectedMongoDB && ext.connectedMongoDB.id === node.id) {
            setConnectedNode(undefined, codeLensProvider);
            context.globalState.update(connectedDBKey, undefined);
            languageClient.disconnect();
        }
    });
    actionHandler.registerCommand('cosmosDB.deleteMongoCollection', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(MongoCollectionTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.deleteMongoDocument', async (node?: IAzureNode) => {
        if (!node) {
            node = await tree.showNodePicker(MongoDocumentTreeItem.contextValue);
        }
        await node.deleteNode();
    });
    actionHandler.registerCommand('cosmosDB.openCollection', async (node?: IAzureParentNode<MongoCollectionTreeItem>) => {
        if (!node) {
            node = <IAzureParentNode<MongoCollectionTreeItem>>await tree.showNodePicker(MongoCollectionTreeItem.contextValue);
        }
        await editorManager.showDocument(new MongoCollectionNodeEditor(node), 'cosmos-collection.json');
    });
    actionHandler.registerCommand('cosmosDB.launchMongoShell', launchMongoShell);
    actionHandler.registerCommand('cosmosDB.newMongoScrapbook', async () => await vscodeUtil.showNewFile('', context.extensionPath, 'Scrapbook', '.mongo'));
    actionHandler.registerCommand('cosmosDB.executeMongoCommand', async function (this: IActionContext, commandText: object) {
        await loadPersistedMongoDBTask;
        if (typeof commandText === "string") {
            await executeCommandFromText(<IAzureParentNode<MongoDatabaseTreeItem>>ext.connectedMongoDB, context.extensionPath, editorManager, tree, this, <string>commandText);
        } else {
            await executeCommandFromActiveEditor(<IAzureParentNode<MongoDatabaseTreeItem>>ext.connectedMongoDB, context.extensionPath, editorManager, tree, this);
        }
    });
    actionHandler.registerCommand('cosmosDB.executeAllMongoCommands', async function (this: IActionContext) {
        await loadPersistedMongoDBTask;
        await executeAllCommandsFromActiveEditor(<IAzureParentNode<MongoDatabaseTreeItem>>ext.connectedMongoDB, context.extensionPath, editorManager, tree, this);
    });
}

async function loadPersistedMongoDB(context: vscode.ExtensionContext, tree: AzureTreeDataProvider, languageClient: MongoDBLanguageClient, codeLensProvider: MongoCodeLensProvider): Promise<void> {
    // NOTE: We want to make sure this function never throws or returns a rejected promise because it gets awaited multiple times
    await callWithTelemetryAndErrorHandling('cosmosDB.loadPersistedMongoDB', reporter, vscodeUtil.getOutputChannel(), async function (this: IActionContext): Promise<void> {
        this.suppressErrorDisplay = true;
        this.properties.isActivationEvent = 'true';

        try {
            const persistedNodeId: string | undefined = context.globalState.get(connectedDBKey);
            if (persistedNodeId) {
                const persistedNode = await tree.findNode(persistedNodeId);
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

function setConnectedNode(node: IAzureNode | undefined, codeLensProvider: MongoCodeLensProvider) {
    ext.connectedMongoDB = node;
    let dbName = node && node.treeItem.label;
    codeLensProvider.setConnectedDatabase(dbName);
}

function setUpErrorReporting(handler: AzureActionHandler, reporter: TelemetryReporter, output: vscode.OutputChannel) {
    // Update errors immediately in case a scrapbook is already open
    callWithTelemetryAndErrorHandling(
        "initialUpdateErrorsInActiveDocument",
        reporter,
        output,
        async function (this: IActionContext): Promise<void> {
            updateErrorsInScrapbook(this, vscode.window.activeTextEditor && vscode.window.activeTextEditor.document);
        });

    // Update errors when document opened/changed
    handler.registerEvent(
        'vscode.workspace.onDidOpenTextDocument',
        vscode.workspace.onDidOpenTextDocument,
        async function (this: IActionContext, document: vscode.TextDocument) {
            updateErrorsInScrapbook(this, document);
        });
    handler.registerEvent(
        'vscode.workspace.onDidChangeTextDocument',
        vscode.workspace.onDidChangeTextDocument,
        async function (this: IActionContext, event: vscode.TextDocumentChangeEvent) {
            // Always suppress success telemetry - event happens on every keystroke
            this.suppressTelemetry = true;

            updateErrorsInScrapbook(this, event.document);
        });
    handler.registerEvent(
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
