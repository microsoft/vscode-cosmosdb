/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as path from "path";
import * as vscode from 'vscode';
import { parseError } from 'vscode-azureextensionui';
import { getResourcesPath } from '../constants';
import { ext } from '../extensionVariables';
import { areConfigsEqual, GraphConfiguration } from './GraphConfiguration';
import { GraphViewServer } from './GraphViewServer';

// grandfathered in
// tslint:disable:typedef

interface IServerProvider {
    findServerById(id: number): GraphViewServer;
}

export class GraphViewsManager implements IServerProvider { //Graphviews Panel
    private _lastServerId = 0;

    // One server (and one webview panel) per graph, as represented by unique configurations
    private readonly _servers = new Map<number, GraphViewServer>(); // map of id -> server
    private readonly _panels = new Map<number, vscode.WebviewPanel>(); // map of id -> webview panel
    private readonly _panelViewType: string = "CosmosDB.GraphExplorer";

    public async showGraphViewer(
        tabTitle: string,
        config: GraphConfiguration
    ): Promise<void> {
        let id: number;
        try {
            id = await this.getOrCreateServer(config);
        } catch (err) {
            vscode.window.showErrorMessage(parseError(err).message);
        }
        const existingPanel: vscode.WebviewPanel = this._panels.get(id);
        if (existingPanel) {
            existingPanel.reveal();
            return;
        }
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        const options: vscode.WebviewOptions & vscode.WebviewPanelOptions = {
            enableScripts: true,
            enableCommandUris: true,
            enableFindWidget: true,
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.file(ext.context.extensionPath)]
        };
        const panel = vscode.window.createWebviewPanel(this._panelViewType, tabTitle, { viewColumn: column, preserveFocus: true }, options);
        const contentProvider = new WebviewContentProvider(this);
        panel.webview.html = await contentProvider.provideHtmlContent(id);
        this._panels.set(id, panel);
        panel.onDidDispose(
            // dispose the server
            () => {
                const server = this._servers.get(id);
                server.dispose();
                this._servers.delete(id);
                this._panels.delete(id);
            }
        );
        panel.reveal();
    }

    public findServerById(id: number): GraphViewServer {
        return this._servers.get(id);
    }

    private async getOrCreateServer(config: GraphConfiguration): Promise<number> {
        let existingServer: GraphViewServer = null;
        let existingId: number;
        this._servers.forEach((svr, key) => {
            if (areConfigsEqual(svr.configuration, config)) {
                existingServer = svr;
                existingId = key;
            }
        });
        if (existingServer) {
            return existingId;
        }

        const server = new GraphViewServer(config);
        await server.start();

        this._lastServerId += 1;
        const id = this._lastServerId;
        this._servers.set(id, server);
        return id;
    }

}

class WebviewContentProvider {
    public onDidChange?: vscode.Event<vscode.Uri>;

    public constructor(private _serverProvider: IServerProvider) { }

    public async provideHtmlContent(serverId: number): Promise<string> {
        console.assert(serverId > 0);
        const server = this._serverProvider.findServerById(serverId);
        if (server) {
            return await this._graphClientHtmlAsString(server.port);
        }

        throw new Error("This resource is no longer available.");
    }

    private async _graphClientHtmlAsString(port: number): Promise<string> {
        const graphClientAbsolutePath = path.join(getResourcesPath(), 'graphClient', 'graphClient.html');
        let htmlContents: string = await fse.readFile(graphClientAbsolutePath, 'utf8');
        const portPlaceholder: RegExp = /\$CLIENTPORT/g;
        htmlContents = htmlContents.replace(portPlaceholder, String(port));
        const uriPlaceholder: RegExp = /\$BASEURI/g;
        const uri = vscode.Uri.parse(path.join("file:" + ext.context.extensionPath));
        const baseUri = `vscode-resource:${uri.fsPath}`;
        htmlContents = htmlContents.replace(uriPlaceholder, baseUri);

        return htmlContents;
    }

}
