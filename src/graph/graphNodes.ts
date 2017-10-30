/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as path from 'path';
import { Command } from 'vscode';
import { DocumentClient } from 'documentdb';
import { INode } from '../nodes';
import * as util from "./../util";

export class GraphDatabaseNode implements INode {
	public readonly contextValue: string = "cosmosGraphDatabase";

	private _graphEndpoint: string;
	private _graphPort: number;

	constructor(readonly id: string, private readonly _masterKey: string, private readonly _documentEndpoint: string, readonly server: INode) {
		this._parseEndpoint(_documentEndpoint);
	}

	private _parseEndpoint(documentEndpoint: string): void {
		// Document endpoint: https://<graphname>.documents.azure.com:443/
		// Gremlin endpoint: stephwegraph1.graphs.azure.com
		let [, address, , port] = this._documentEndpoint.match(/^[^:]+:\/\/([^:]+)(:([0-9]+))?\/?$/);
		this._graphEndpoint = address.replace(".documents.azure.com", ".graphs.azure.com");
		console.assert(this._graphEndpoint.match(/\.graphs\.azure\.com$/), "Unexpected endpoint format");
		this._graphPort = parseInt(port || "443");
		console.assert(this._graphPort > 0, "Unexpected port");
	}

	getMasterKey(): string {
		return this._masterKey;
	}

	get documentEndpoint(): string {
		return this._documentEndpoint;
	}

	get graphEndpoint(): string {
		return this._graphEndpoint;
	}

	get graphPort(): number {
		return this._graphPort;
	}

	get label(): string {
		return this.id;
	}

	get iconPath(): any {
		return undefined;
	}

	readonly collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;

	public getGraphLink(): string {
		return 'dbs/' + this.id;
	}

	async getChildren(): Promise<INode[]> {
		const dbLink: string = this.getGraphLink();
		const parentNode = this;
		const client = new DocumentClient(this.documentEndpoint, { masterKey: this.getMasterKey() });
		let collections = await this.listCollections(dbLink, client);
		return collections.map(collection => new GraphNode(collection.id, parentNode));
	}

	private async listCollections(databaseLink, client): Promise<any> {
		let collections = await client.readCollections(databaseLink);
		return await new Promise<any[]>((resolve, reject) => {
			collections.toArray((err, cols: Array<Object>) => err ? reject(err) : resolve(cols));
		});
	}

}

export class GraphNode implements INode {

	readonly collapsibleState = vscode.TreeItemCollapsibleState.None;

	constructor(readonly id: string, readonly graphDBNode: GraphDatabaseNode) {
	}

	readonly contextValue: string = "cosmosGraph";

	get label(): string {
		return this.id;
	}

	get iconPath(): any {
		return undefined;
	}

	getCollLink(): string {
		return this.graphDBNode.getGraphLink() + '/colls/' + this.id;
	}

	readonly command: Command = {
		command: 'graph.openExplorer',
		arguments: [this],
		title: ''
	};
}
