/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as copypaste from 'copy-paste';
import * as vscode from 'vscode';
import { AzureTreeDataProvider, AzureTreeItem, AzureUserInput, IActionContext, IAzureUserInput, registerCommand, registerEvent, registerUIExtensionVariables, SubscriptionTreeItem } from 'vscode-azureextensionui';
import { importDocuments } from './commands/importDocuments';
import { CosmosEditorManager } from './CosmosEditorManager';
import { DocDBDocumentNodeEditor } from './docdb/editors/DocDBDocumentNodeEditor';
import { registerDocDBCommands } from './docdb/registerDocDBCommands';
import { DocDBAccountTreeItem } from './docdb/tree/DocDBAccountTreeItem';
import { DocDBAccountTreeItemBase } from './docdb/tree/DocDBAccountTreeItemBase';
import { DocDBCollectionTreeItem } from './docdb/tree/DocDBCollectionTreeItem';
import { DocDBDatabaseTreeItem } from './docdb/tree/DocDBDatabaseTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { ext } from './extensionVariables';
import { registerGraphCommands } from './graph/registerGraphCommands';
import { GraphAccountTreeItem } from './graph/tree/GraphAccountTreeItem';
import { MongoDocumentNodeEditor } from './mongo/editors/MongoDocumentNodeEditor';
import { registerMongoCommands } from './mongo/registerMongoCommands';
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
import { MongoCollectionTreeItem } from './mongo/tree/MongoCollectionTreeItem';
import { MongoDatabaseTreeItem } from './mongo/tree/MongoDatabaseTreeItem';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { TableAccountTreeItem } from './table/tree/TableAccountTreeItem';
import { AttachedAccountsTreeItem, AttachedAccountSuffix } from './tree/AttachedAccountsTreeItem';
import { CosmosDBAccountProvider } from './tree/CosmosDBAccountProvider';
import * as cpUtil from './utils/cp';
import { Reporter } from './utils/telemetry';

export function activate(context: vscode.ExtensionContext) {
	registerUIExtensionVariables(ext);
	ext.context = context;
	context.subscriptions.push(new Reporter(context));

	const ui: IAzureUserInput = new AzureUserInput(context.globalState);
	ext.ui = ui;

	const attachedAccountsNode: AttachedAccountsTreeItem = new AttachedAccountsTreeItem(context.globalState);
	const tree: AzureTreeDataProvider = new AzureTreeDataProvider(CosmosDBAccountProvider, 'cosmosDB.loadMore', [attachedAccountsNode]);
	context.subscriptions.push(tree);
	ext.tree = tree;
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cosmosDBExplorer', tree));

	const editorManager: CosmosEditorManager = new CosmosEditorManager(context.globalState);

	ext.outputChannel = vscode.window.createOutputChannel("Azure Cosmos DB");
	context.subscriptions.push(ext.outputChannel);

	registerDocDBCommands(editorManager);
	registerGraphCommands(context);
	registerMongoCommands(context, editorManager);

	// Common commands
	const accountContextValues: string[] = [GraphAccountTreeItem.contextValue, DocDBAccountTreeItem.contextValue, TableAccountTreeItem.contextValue, MongoAccountTreeItem.contextValue];

	registerCommand('cosmosDB.selectSubscriptions', () => vscode.commands.executeCommand("azure-account.selectSubscriptions"));

	registerCommand('cosmosDB.createAccount', async function (this: IActionContext, node?: SubscriptionTreeItem): Promise<void> {
		if (!node) {
			node = <SubscriptionTreeItem>await tree.showTreeItemPicker(SubscriptionTreeItem.contextValue);
		}

		await node.createChild(this);
	});
	registerCommand('cosmosDB.deleteAccount', async (node?: AzureTreeItem) => {
		if (!node) {
			node = await tree.showTreeItemPicker(accountContextValues);
		}

		await node.deleteTreeItem();
	});

	registerCommand('cosmosDB.attachDatabaseAccount', async () => {
		await attachedAccountsNode.attachNewAccount();
		await tree.refresh(attachedAccountsNode);
	});
	registerCommand('cosmosDB.attachEmulator', async () => {
		await attachedAccountsNode.attachEmulator();
		await tree.refresh(attachedAccountsNode);
	});
	registerCommand('cosmosDB.refresh', async (node?: AzureTreeItem) => await tree.refresh(node));
	registerCommand('cosmosDB.detachDatabaseAccount', async (node?: AzureTreeItem) => {
		if (!node) {
			node = await tree.showTreeItemPicker(accountContextValues.map((val: string) => val += AttachedAccountSuffix), attachedAccountsNode);
		}

		await attachedAccountsNode.detach(node.id);
		await tree.refresh(attachedAccountsNode);
	});
	registerCommand('cosmosDB.importDocument', async (selectedNode: vscode.Uri | MongoCollectionTreeItem | DocDBCollectionTreeItem, uris: vscode.Uri[]) => //ignore first pass
	{
		if (selectedNode instanceof vscode.Uri) {
			await importDocuments(uris || [selectedNode], undefined);
		} else {
			await importDocuments(undefined, selectedNode);
		}
	});

	registerCommand('cosmosDB.openInPortal', async (node?: AzureTreeItem) => {
		if (!node) {
			node = await tree.showTreeItemPicker(accountContextValues);
		}

		node.openInPortal();
	});
	registerCommand('cosmosDB.copyConnectionString', async (node?: MongoAccountTreeItem | DocDBAccountTreeItemBase) => {
		if (!node) {
			node = <MongoAccountTreeItem | DocDBAccountTreeItemBase>await tree.showTreeItemPicker(accountContextValues);
		}

		await copyConnectionString(node);
	});
	registerCommand('cosmosDB.openDocument', async (node?: MongoDocumentTreeItem | DocDBDocumentTreeItem) => {
		if (!node) {
			node = <MongoDocumentTreeItem | DocDBDocumentTreeItem>await tree.showTreeItemPicker([MongoDocumentTreeItem.contextValue, DocDBDocumentTreeItem.contextValue]);
		}

		if (node instanceof MongoDocumentTreeItem) {
			await editorManager.showDocument(new MongoDocumentNodeEditor(node), 'cosmos-document.json');
		} else {
			await editorManager.showDocument(new DocDBDocumentNodeEditor(node), 'cosmos-document.json');
		}
	});
	registerCommand('cosmosDB.update', (filePath: vscode.Uri) => editorManager.updateMatchingNode(filePath));
	registerCommand('cosmosDB.loadMore', (node?: AzureTreeItem) => tree.loadMore(node));
	registerEvent('cosmosDB.CosmosEditorManager.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument, async function (
		this: IActionContext, doc: vscode.TextDocument): Promise<void> {
		await editorManager.onDidSaveTextDocument(this, doc);
	});
	registerEvent(
		'cosmosDB.onDidChangeConfiguration',
		vscode.workspace.onDidChangeConfiguration,
		async function (this: IActionContext, event: vscode.ConfigurationChangeEvent): Promise<void> {
			this.properties.isActivationEvent = "true";
			this.suppressErrorDisplay = true;
			if (event.affectsConfiguration(ext.settingsKeys.documentLabelFields)) {
				await vscode.commands.executeCommand("cosmosDB.refresh");
			}
		});
	registerCommand('cosmosDB.api.revealTreeItem', async (treeItemId: string) => {
		const customView = vscode.window.createTreeView('cosmosDBExplorer', { treeDataProvider: tree });
		const node = await tree.findTreeItem(treeItemId);
		if (!node) {
			throw new Error(`Couldn't find the database node in Cosmos DB with provided Id: ${treeItemId}`);
		}
		customView.reveal(node);
	});
	registerCommand('cosmosDB.api.getDatabase', async () => {
		return (await tree.showTreeItemPicker([MongoDatabaseTreeItem.contextValue, DocDBDatabaseTreeItem.contextValue])).fullId;
	});
	registerCommand('cosmosDB.api.getConnectionString', async (treeItemId: string) => {
		const node = await tree.findTreeItem(treeItemId);
		if (!node) {
			throw new Error(`Couldn't find the database node in Cosmos DB with provided Id: ${treeItemId}`);
		}

		if (node instanceof MongoDatabaseTreeItem) {
			return node.connectionString;
		} else {
			throw new Error('Not implemented yet. For now works only with Mongo.');
		}
	});
}

async function copyConnectionString(node: MongoAccountTreeItem | DocDBAccountTreeItemBase) {
	if (process.platform !== 'linux' || (await cpUtil.commandSucceeds('xclip', '-version'))) {
		copypaste.copy(node.connectionString);
	} else {
		vscode.window.showErrorMessage('You must have xclip installed to copy the connection string.');
	}
}

// this method is called when your extension is deactivated
export function deactivate() {
	// NOOP
}
