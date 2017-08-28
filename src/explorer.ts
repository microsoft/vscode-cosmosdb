/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { TreeDataProvider, Command, Event, EventEmitter, Disposable, TreeItem, ExtensionContext } from 'vscode';
import { CosmosDBRootNode, INode } from './nodes';

export class CosmosDBExplorer implements TreeDataProvider<INode> {

	private _disposables: Map<INode, Disposable[]> = new Map<INode, Disposable[]>();

	private _onDidChangeTreeData: EventEmitter<INode> = new EventEmitter<INode>();
	readonly onDidChangeTreeData: Event<INode> = this._onDidChangeTreeData.event;

	constructor(private rootNode: CosmosDBRootNode) {
		this.rootNode.onChange(() => this._onDidChangeTreeData.fire());
	}

	getTreeItem(node: INode): TreeItem {
		return node;
	}

	getChildren(node: INode): Thenable<INode[]> {
		node = node ? node : this.rootNode;
		const disposables = this._disposables.get(node);
		if (disposables) {
			for (const disposable of disposables) {
				disposable.dispose();
			}
		}
		return node.getChildren().then(children => {
			this._disposables.set(node, children.map(child => {
				if (child.onChange) {
					return child.onChange(() => this._onDidChangeTreeData.fire(child));
				}
				return new Disposable(() => { });
			}));
			return children;
		});
	}

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}
}