/*--------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as copypaste from 'copy-paste';
import { NewDocument } from 'documentdb';
import * as vscode from 'vscode';
import { AzureTreeDataProvider, AzureUserInput, IActionContext, IAzureNode, IAzureParentNode, IAzureUserInput, parseError, registerCommand, registerEvent, registerUIExtensionVariables, UserCancelledError } from 'vscode-azureextensionui';
import { CosmosEditorManager } from './CosmosEditorManager';
import { DocDBDocumentNodeEditor } from './docdb/editors/DocDBDocumentNodeEditor';
import { registerDocDBCommands } from './docdb/registerDocDBCommands';
import { DocDBAccountTreeItem } from './docdb/tree/DocDBAccountTreeItem';
import { DocDBAccountTreeItemBase } from './docdb/tree/DocDBAccountTreeItemBase';
import { DocDBCollectionTreeItem } from './docdb/tree/DocDBCollectionTreeItem';
import { DocDBDocumentsTreeItem } from './docdb/tree/DocDBDocumentsTreeItem';
import { DocDBDocumentTreeItem } from './docdb/tree/DocDBDocumentTreeItem';
import { ext } from './extensionVariables';
import { registerGraphCommands } from './graph/registerGraphCommands';
import { GraphAccountTreeItem } from './graph/tree/GraphAccountTreeItem';
import { MongoDocumentNodeEditor } from './mongo/editors/MongoDocumentNodeEditor';
import { registerMongoCommands } from './mongo/registerMongoCommands';
import { MongoAccountTreeItem } from './mongo/tree/MongoAccountTreeItem';
import { MongoCollectionTreeItem } from './mongo/tree/MongoCollectionTreeItem';
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
	registerCommand('cosmosDB.importDocument', async (selectedNode: vscode.Uri | IAzureNode<MongoCollectionTreeItem | DocDBCollectionTreeItem>, nodes: vscode.Uri[]) => //ignore first pass
	{
		if (selectedNode instanceof vscode.Uri) {
			importDocuments(tree, nodes, undefined);
		} else {
			importDocuments(tree, undefined, <IAzureParentNode<MongoCollectionTreeItem | DocDBCollectionTreeItem>>selectedNode);
		}
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
		async function
			(this: IActionContext, event: vscode.ConfigurationChangeEvent): Promise<void> {
			this.properties.isActivationEvent = "true";
			this.suppressErrorDisplay = true;
			if (event.affectsConfiguration(ext.settingsKeys.documentLabelFields)) {
				await vscode.commands.executeCommand("cosmosDB.refresh");
			}
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

async function importDocuments(tree: AzureTreeDataProvider, nodes: vscode.Uri[] | undefined, collectionNode: IAzureParentNode<MongoCollectionTreeItem | DocDBCollectionTreeItem> | undefined): Promise<void> {
	if (!nodes) {
		nodes = await askForDocuments();
	}
	const documents = await parseDocumentsForErrors(nodes);

	if (!collectionNode) {
		collectionNode = <IAzureParentNode<MongoCollectionTreeItem | DocDBCollectionTreeItem>>await tree.showNodePicker([MongoCollectionTreeItem.contextValue, DocDBCollectionTreeItem.contextValue]);
	}
	let result: string;
	if (collectionNode.treeItem instanceof MongoCollectionTreeItem) {
		const collectionTreeItem = <MongoCollectionTreeItem>collectionNode.treeItem;
		//tslint:disable:no-non-null-assertion
		result = await collectionTreeItem!.executeCommand('insertMany', [JSON.stringify(documents)]);
	} else {
		result = await insertDocumentsIntoDocdb(<IAzureParentNode<DocDBCollectionTreeItem>>collectionNode, documents, nodes);
	}
	await collectionNode.refresh();
	await vscode.window.showInformationMessage(result);
}

async function askForDocuments(): Promise<vscode.Uri[]> {
	let files: vscode.Uri[] = await vscode.workspace.findFiles("*.json");
	let jsonDocuments: (vscode.QuickPickItem & { uri: vscode.Uri })[] = [];
	let items: (vscode.QuickPickItem & { uri: vscode.Uri })[] = files.map(file => {
		return { uri: file, label: vscode.workspace.asRelativePath(file) };
	});
	let pickAgain: string = "Pick again";
	let discontinue = "Discontiue import";
	while (!jsonDocuments.length) {
		jsonDocuments = await ext.ui.showQuickPick(items, { canPickMany: true, placeHolder: "Choose a document to upload. Hit Escape to Cancel" });
		if (!jsonDocuments.length) {
			let action: string = await vscode.window.showWarningMessage("No document picked. Want to pick again?", pickAgain, discontinue);
			if (action === discontinue) {
				throw new UserCancelledError();
			}
		}
	}
	return jsonDocuments.map(choice => choice.uri);
}

// tslint:disable-next-line:no-any
async function parseDocumentsForErrors(nodes: vscode.Uri[]): Promise<any[]> {
	const parseResult = await parseDocuments(nodes);
	const documents = parseResult[0];
	const errors: string[] = parseResult[1];
	if (errors.length > 0) {
		ext.outputChannel.show();
		throw new Error(`Errors found in the following documents: ${errors.join(',')}.\nPlease fix these and try again.`);
	}
	return documents;
}

// tslint:disable-next-line:no-any
async function parseDocuments(nodes: vscode.Uri[]): Promise<[any[], string[]]> {
	let documents = [];
	let errors = {};
	for (let node of nodes) {
		const document = (await vscode.workspace.openTextDocument(node));
		const text = document.getText();
		let parsed;
		try {
			parsed = JSON.parse(text);
		} catch (e) {
			const err = parseError(e);
			const fileName = node.path.split('/').pop();
			errors[fileName] = err;
			ext.outputChannel.appendLine(`${fileName}:\n${err}`);
			await vscode.window.showTextDocument(document);
		}
		if (parsed) {
			if (Array.isArray(parsed)) {
				documents = documents.concat(parsed);
			} else {
				documents.push(parsed);
			}
		}
	}
	return [documents, Object.keys(errors)];
}

// tslint:disable-next-line:no-any
async function insertDocumentsIntoDocdb(collectionNode: IAzureParentNode<DocDBCollectionTreeItem>, documents: any[], nodes: vscode.Uri[]): Promise<string> {
	let result;
	let ids = [];
	const collectionTreeItem = (<DocDBCollectionTreeItem>collectionNode.treeItem);
	const documentsTreeItem: DocDBDocumentsTreeItem = <DocDBDocumentsTreeItem>(await collectionTreeItem.loadMoreChildren(collectionNode, false))[0];
	let i = 0;
	for (i = 0; i < documents.length; i++) {
		let document: NewDocument = documents[i];
		if (!documentsTreeItem.documentHasPartitionKey(document)) {
			throw new Error(`Error in file ${vscode.workspace.asRelativePath(nodes[i])}. Please ensure every document has a partition key path for the collection you choose to import into.`);
		}
		const retrieved = await documentsTreeItem.createDocument(document);
		ids.push(retrieved.id);
	}
	result = `Imported ${ids.length} documents`;
	return result;
}

// this method is called when your extension is deactivated
export function deactivate() {
	// NOOP
}
