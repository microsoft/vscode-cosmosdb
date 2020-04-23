/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CollectionMeta } from 'documentdb';
import * as vscode from 'vscode';
import { AzureTreeItem, IActionContext, UserCancelledError } from 'vscode-azureextensionui';
import { AzureExtensionApiProvider } from 'vscode-azureextensionui/api';
import { getThemeAgnosticIconPath } from '../../constants';
import { IDocDBTreeRoot } from '../../docdb/tree/IDocDBTreeRoot';
import { ext } from '../../extensionVariables';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { CosmosDBGraphExtensionApi } from '../../vscode-cosmosdbgraph.api';
import { GraphCollectionTreeItem } from './GraphCollectionTreeItem';
import { GraphDatabaseTreeItem } from './GraphDatabaseTreeItem';

export class GraphTreeItem extends AzureTreeItem<IDocDBTreeRoot> {
    public static contextValue: string = "cosmosDBGraphGraph";
    public readonly contextValue: string = GraphTreeItem.contextValue;
    public readonly commandId: string = 'azureDatabases.openGraphExplorer';
    public readonly parent: GraphCollectionTreeItem;

    private readonly _collection: CollectionMeta;
    private _graphApi: CosmosDBGraphExtensionApi | undefined;

    constructor(parent: GraphCollectionTreeItem, collection: CollectionMeta) {
        super(parent);
        this._collection = collection;
    }

    public get id(): string {
        return this._collection.id;
    }

    public get label(): string {
        return "Graph";
    }

    public get link(): string {
        return this._collection._self;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('Collection.svg');
    }

    public async showExplorer(context: IActionContext): Promise<void> {
        const graphApi: CosmosDBGraphExtensionApi = await this.getGraphApi(context);
        const databaseTreeItem: GraphDatabaseTreeItem = this.parent.parent;
        await graphApi.openGraphExplorer({
            documentEndpoint: databaseTreeItem.root.documentEndpoint,
            gremlinEndpoint: databaseTreeItem.gremlinEndpoint,
            possibleGremlinEndpoints: databaseTreeItem.possibleGremlinEndpoints,
            databaseName: databaseTreeItem.label,
            graphName: this._collection.id,
            key: databaseTreeItem.root.masterKey,
            tabTitle: this._collection.id
        });
    }

    private async getGraphApi(context: IActionContext): Promise<CosmosDBGraphExtensionApi> {
        if (this._graphApi) {
            return this._graphApi;
        } else {
            const graphExtId: string = 'ms-azuretools.vscode-cosmosdbgraph';
            const graphExtension: vscode.Extension<AzureExtensionApiProvider | undefined> | undefined = vscode.extensions.getExtension(graphExtId);
            if (graphExtension) {
                if (!graphExtension.isActive) {
                    await graphExtension.activate();
                }

                this._graphApi = nonNullProp(graphExtension, 'exports').getApi<CosmosDBGraphExtensionApi>('^1.0.0');
                return this._graphApi;
            } else {
                const viewExt: vscode.MessageItem = { title: localize('viewExt', 'View Extension') };
                const message: string = localize('mustInstallGraph', 'You must install the Cosmos DB Graph extension to view a graph.');
                context.telemetry.properties.cancelStep = 'installGraphExtPreMessage';
                await ext.ui.showWarningMessage(message, { modal: true }, viewExt);
                context.telemetry.properties.cancelStep = 'installGraphExtPostMessage';
                await vscode.commands.executeCommand('extension.open', graphExtId);
                throw new UserCancelledError();
            }
        }
    }
}
