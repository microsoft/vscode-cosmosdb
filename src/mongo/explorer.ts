/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { TreeDataProvider, Command, Event, EventEmitter, Disposable, TreeItem, ExtensionContext } from 'vscode';
import { Model, Server, Database, IMongoResource } from './mongo';

export class MongoExplorer implements TreeDataProvider<IMongoResource> {

	private _disposables: Map<IMongoResource, Disposable[]> = new Map<IMongoResource, Disposable[]>();

	private _onDidChangeTreeData: EventEmitter<IMongoResource> = new EventEmitter<IMongoResource>();
	readonly onDidChangeTreeData: Event<IMongoResource> = this._onDidChangeTreeData.event;

	constructor(private model: Model, private extensionContext: ExtensionContext) {
		this.model.onChange(() => this._onDidChangeTreeData.fire());
	}

	getTreeItem(node: IMongoResource): TreeItem {
		return node;
	}

	getChildren(node: IMongoResource): Thenable<IMongoResource[]> {
		node = node ? node : this.model;
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