/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TreeDataProvider, Event, EventEmitter, Memento, TreeItem } from 'vscode';
import { AttachedServersNode, LoadingNode, NoSubscriptionsNode, SignInToAzureNode, SubscriptionNode, INode } from './nodes';
import { AzureAccount } from './azure-account.api';

export class CosmosDBExplorer implements TreeDataProvider<INode> {
	private _onDidChangeTreeData: EventEmitter<INode> = new EventEmitter<INode>();
	readonly onDidChangeTreeData: Event<INode> = this._onDidChangeTreeData.event;

	readonly attachedServersNode: AttachedServersNode;

	constructor(private azureAccount: AzureAccount, globalState: Memento) {
		this.attachedServersNode = new AttachedServersNode(azureAccount, globalState);
	}

	getTreeItem(node: INode): TreeItem {
		return node;
	}

	async getChildren(node?: INode): Promise<INode[]> {
		let nodes: INode[] = [];

		if (node) {
			nodes = await node.getChildren();
		} else { // Root of the explorer
			if (this.azureAccount.status === "Initializing" || this.azureAccount.status === "LoggingIn") {
				nodes.push(new LoadingNode());
			} else if (this.azureAccount.status === "LoggedOut") {
				nodes.push(new SignInToAzureNode());
			} else if (this.azureAccount.filters.length === 0) {
				nodes.push(new NoSubscriptionsNode());
			} else {
				nodes = this.azureAccount.filters.map(filter => new SubscriptionNode(filter))
			}

			nodes.push(this.attachedServersNode);
		}

		return nodes;
	}

	refresh(node?: INode): void {
		this._onDidChangeTreeData.fire(node);
	}
}