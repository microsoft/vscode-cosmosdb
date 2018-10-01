/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as copypaste from 'copy-paste';
import * as vscode from 'vscode';
import { AzureTreeDataProvider, AzureUserInput, IActionContext, IAzureNode, IAzureParentNode, IAzureUserInput, registerCommand, registerEvent, registerUIExtensionVariables } from 'vscode-azureextensionui';
import { CosmosEditorManager } from './CosmosEditorManager';
import { DocDBDocumentNodeEditor } from './docdb/editors/DocDBDocumentNodeEditor';
import { registerDocDBCommands } from './docdb/registerDocDBCommands';
import { DocDBAccountTreeItem } from './docdb/tree/DocDBAccountTreeItem';
import { DocDBAccountTreeItemBase } from './docdb/tree/DocDBAccountTreeItemBase';
import { DocDBDatabaseTreeItem } from './docdb/tree/DocDBDatabaseTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { ext } from './extensionVariables';
import { registerGraphCommands } from './graph/registerGraphCommands';
import { GraphAccountTreeItem } from './graph/tree/GraphAccountTreeItem';
import { MongoDocumentNodeEditor } from './mongo/editors/MongoDocumentNodeEditor';
import { registerMongoCommands } from './mongo/registerMongoCommands';
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
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

	const tree: AzureTreeDataProvider = new AzureTreeDataProvider(new CosmosDBAccountProvider(), 'cosmosDB.loadMore', [new AttachedAccountsTreeItem(context.globalState)]);
	context.subscriptions.push(tree);
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cosmosDBExplorer', tree));

	const editorManager: CosmosEditorManager = new CosmosEditorManager(context.globalState);

	ext.outputChannel = vscode.window.createOutputChannel("Azure Cosmos DB");
	context.subscriptions.push(ext.outputChannel);

	registerDocDBCommands(tree, editorManager);
	registerGraphCommands(context, tree);
	registerMongoCommands(context, tree, editorManager);

	// Common commands
	const accountContextValues: string[] = [GraphAccountTreeItem.contextValue, DocDBAccountTreeItem.contextValue, TableAccountTreeItem.contextValue, MongoAccountTreeItem.contextValue];

	registerCommand('cosmosDB.selectSubscriptions', () => vscode.commands.executeCommand("azure-account.selectSubscriptions"));

	registerCommand('cosmosDB.createAccount', async function (this: IActionContext, node?: IAzureParentNode): Promise<void> {
		if (!node) {
			node = <IAzureParentNode>await tree.showNodePicker(AzureTreeDataProvider.subscriptionContextValue);
		}

		await node.createChild(this);
	});
	registerCommand('cosmosDB.deleteAccount', async (node?: IAzureNode) => {
		if (!node) {
			node = await tree.showNodePicker(accountContextValues);
		}

		await node.deleteNode();
	});

	registerCommand('cosmosDB.attachDatabaseAccount', async () => {
		const attachedAccountsNode = await getAttachedNode(tree);
		await attachedAccountsNode.treeItem.attachNewAccount();
		await tree.refresh(attachedAccountsNode);
	});
	registerCommand('cosmosDB.attachEmulator', async () => {
		const attachedAccountsNode = await getAttachedNode(tree);
		await attachedAccountsNode.treeItem.attachEmulator();
		await tree.refresh(attachedAccountsNode);
	});
	registerCommand('cosmosDB.refresh', async (node?: IAzureNode) => await tree.refresh(node));
	registerCommand('cosmosDB.detachDatabaseAccount', async (node?: IAzureNode) => {
		const attachedNode: IAzureParentNode<AttachedAccountsTreeItem> = await getAttachedNode(tree);
		if (!node) {
			node = await tree.showNodePicker(accountContextValues.map((val: string) => val += AttachedAccountSuffix), attachedNode);
		}

		await attachedNode.treeItem.detach(node.treeItem.id);
		await tree.refresh(attachedNode);
	});
	registerCommand('cosmosDB.openInPortal', async (node?: IAzureNode) => {
		if (!node) {
			node = await tree.showNodePicker(accountContextValues);
		}

		node.openInPortal();
	});
	registerCommand('cosmosDB.copyConnectionString', async (node?: IAzureNode<MongoAccountTreeItem | DocDBAccountTreeItemBase>) => {
		if (!node) {
			node = <IAzureNode<MongoAccountTreeItem | DocDBAccountTreeItemBase>>await tree.showNodePicker(accountContextValues);
		}

		await copyConnectionString(node);
	});
	registerCommand('cosmosDB.openDocument', async (node?: IAzureNode) => {
		if (!node) {
			node = await tree.showNodePicker([MongoDocumentTreeItem.contextValue, DocDBDocumentTreeItem.contextValue]);
		}

		if (node.treeItem instanceof MongoDocumentTreeItem) {
			await editorManager.showDocument(new MongoDocumentNodeEditor(<IAzureNode<MongoDocumentTreeItem>>node), 'cosmos-document.json');
		} else if (node.treeItem instanceof DocDBDocumentTreeItem) {
			await editorManager.showDocument(new DocDBDocumentNodeEditor(<IAzureNode<DocDBDocumentTreeItem>>node), 'cosmos-document.json');
		}
	});
	registerCommand('cosmosDB.update', (filePath: vscode.Uri) => editorManager.updateMatchingNode(filePath, tree));
	registerCommand('cosmosDB.loadMore', (node?: IAzureNode) => tree.loadMore(node));
	registerEvent('cosmosDB.CosmosEditorManager.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument, async function (
		this: IActionContext, doc: vscode.TextDocument): Promise<void> {
		await editorManager.onDidSaveTextDocument(this, doc, tree);
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
	registerCommand('cosmosDB.api.getDatabase', async () => {
		return (<IAzureParentNode>await tree.showNodePicker([MongoDatabaseTreeItem.contextValue, DocDBDatabaseTreeItem.contextValue])).id;
	});
}

async function getAttachedNode(tree: AzureTreeDataProvider): Promise<IAzureParentNode<AttachedAccountsTreeItem>> {
	const rootNodes = await tree.getChildren();
	return <IAzureParentNode<AttachedAccountsTreeItem>>rootNodes.find((node) => node.treeItem instanceof AttachedAccountsTreeItem);
}

async function copyConnectionString(node: IAzureNode<MongoAccountTreeItem | DocDBAccountTreeItemBase>) {
	if (process.platform !== 'linux' || (await cpUtil.commandSucceeds('xclip', '-version'))) {
		copypaste.copy(node.treeItem.connectionString);
	} else {
		vscode.window.showErrorMessage('You must have xclip installed to copy the connection string.');
	}
}

// this method is called when your extension is deactivated
export function deactivate() {
	// NOOP
}
