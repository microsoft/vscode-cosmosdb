/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as copypaste from 'copy-paste';
import * as vscodeUtil from './utils/vscodeUtils';
import * as cpUtil from './utils/cp';
import { AzureTreeDataProvider, IAzureNode, AzureActionHandler, IAzureParentNode } from 'vscode-azureextensionui';
import { Reporter, reporter } from './utils/telemetry';
import { CosmosEditorManager } from './CosmosEditorManager';
import { CosmosDBAccountProvider } from './tree/CosmosDBAccountProvider';
import { AttachedAccountsTreeItem, AttachedAccountSuffix } from './tree/AttachedAccountsTreeItem';
import { getOutputChannel } from './utils/vscodeUtils';
import { MongoDocumentNodeEditor } from './mongo/editors/MongoDocumentNodeEditor';
import { MongoDocumentTreeItem } from './mongo/tree/MongoDocumentTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { DocDBDocumentNodeEditor } from './docdb/editors/DocDBDocumentNodeEditor';
import { registerDocDBCommands } from './docdb/registerDocDBCommands';
import { registerGraphCommands } from './graph/registerGraphCommands';
import { registerMongoCommands } from './mongo/registerMongoCommands';
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
import { DocDBAccountTreeItemBase } from './docdb/tree/DocDBAccountTreeItemBase';
import { GraphAccountTreeItem } from './graph/tree/GraphAccountTreeItem';
import { DocDBAccountTreeItem } from './docdb/tree/DocDBAccountTreeItem';
import { TableAccountTreeItem } from './table/tree/TableAccountTreeItem';
import { deleteCosmosDBAccount } from './commands/deleteCosmosDBAccount';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new Reporter(context));

	const tree: AzureTreeDataProvider = new AzureTreeDataProvider(new CosmosDBAccountProvider(), 'cosmosDB.loadMore', [new AttachedAccountsTreeItem(context.globalState)]);
	context.subscriptions.push(tree);
	context.subscriptions.push(vscode.window.registerTreeDataProvider('cosmosDBExplorer', tree));

	const editorManager: CosmosEditorManager = new CosmosEditorManager();
	context.subscriptions.push(editorManager);

	context.subscriptions.push(vscodeUtil.getOutputChannel());

	const actionHandler: AzureActionHandler = new AzureActionHandler(context, getOutputChannel(), reporter);

	registerDocDBCommands(actionHandler, tree);
	registerGraphCommands(context, actionHandler, tree);
	registerMongoCommands(context, actionHandler, tree, editorManager);

	// Common commands
	const accountContextValues: string[] = [GraphAccountTreeItem.contextValue, DocDBAccountTreeItem.contextValue, TableAccountTreeItem.contextValue, MongoAccountTreeItem.contextValue];
	actionHandler.registerCommand('cosmosDB.createAccount', async (node?: IAzureParentNode) => {
		if (!node) {
			node = <IAzureParentNode>await tree.showNodePicker(AzureTreeDataProvider.subscriptionContextValue);
		}

		await node.createChild();
	});
	actionHandler.registerCommand('cosmosDB.deleteAccount', async (node?: IAzureNode) => {
		if (node) {
			node.deleteNode();
		}
	});

	actionHandler.registerCommand('cosmosDB.attachDatabaseAccount', async () => {
		const attachedAccountsNode = await getAttachedNode(tree);
		await attachedAccountsNode.treeItem.attachNewAccount();
		tree.refresh(attachedAccountsNode);
	});
	actionHandler.registerCommand('cosmosDB.attachEmulator', async () => {
		const attachedAccountsNode = await getAttachedNode(tree);
		await attachedAccountsNode.treeItem.attachEmulator();
		tree.refresh(attachedAccountsNode);
	});
	actionHandler.registerCommand('cosmosDB.refresh', async (node?: IAzureNode) => await tree.refresh(node));
	actionHandler.registerCommand('cosmosDB.detachDatabaseAccount', async (node?: IAzureNode) => {
		const attachedNode: IAzureParentNode<AttachedAccountsTreeItem> = await getAttachedNode(tree);
		if (!node) {
			node = await tree.showNodePicker(accountContextValues.map((val: string) => val += AttachedAccountSuffix), attachedNode);
		}

		await attachedNode.treeItem.detach(node.treeItem.id);
		await tree.refresh(attachedNode);
	});
	actionHandler.registerCommand('cosmosDB.openInPortal', async (node?: IAzureNode) => {
		if (!node) {
			node = await tree.showNodePicker(accountContextValues);
		}

		node.openInPortal();
	});
	actionHandler.registerCommand('cosmosDB.copyConnectionString', async (node?: IAzureNode<MongoAccountTreeItem | DocDBAccountTreeItemBase>) => {
		if (!node) {
			node = <IAzureNode<MongoAccountTreeItem | DocDBAccountTreeItemBase>>await tree.showNodePicker(accountContextValues);
		}

		await copyConnectionString(node);
	});
	actionHandler.registerCommand('cosmosDB.openDocument', async (node?: IAzureNode) => {
		if (!node) {
			node = await tree.showNodePicker([MongoDocumentTreeItem.contextValue, DocDBDocumentTreeItem.contextValue]);
		}

		if (node.treeItem instanceof MongoDocumentTreeItem) {
			await editorManager.showDocument(new MongoDocumentNodeEditor(<IAzureNode<MongoDocumentTreeItem>>node), 'cosmos-document.json');
		} else if (node.treeItem instanceof DocDBDocumentTreeItem) {
			await editorManager.showDocument(new DocDBDocumentNodeEditor(<IAzureNode<DocDBDocumentTreeItem>>node), 'cosmos-document.json');
		}
	});
	actionHandler.registerCommand('cosmosDB.update', (filePath: string) => editorManager.updateMatchingNode(filePath));
	actionHandler.registerCommand('cosmosDB.loadMore', (node?: IAzureNode) => tree.loadMore(node));
	actionHandler.registerEvent('cosmosDB.CosmosEditorManager.onDidSaveTextDocument', vscode.workspace.onDidSaveTextDocument,
		(trackTelemetry: () => void, doc: vscode.TextDocument) => editorManager.onDidSaveTextDocument(trackTelemetry, context.globalState, doc));
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
}
