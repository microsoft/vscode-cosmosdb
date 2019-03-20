/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fse from 'fs-extra';
import * as path from "path";
import * as vscode from 'vscode';
import { resourcesPath } from '../constants';
import { areConfigsEqual, GraphConfiguration } from './GraphConfiguration';
import { GraphViewServer } from './GraphViewServer';

interface IServerProvider {
  findServerById(id: number): GraphViewServer;
}

export class GraphViewsManager implements IServerProvider { //Graphviews Panel
  private _lastServerId = 0;

  // One server (and one webview panel) per graph, as represented by unique configurations
  private readonly _servers = new Map<number, GraphViewServer>(); // map of id -> server
  private readonly _panels = new Map<number, vscode.WebviewPanel>(); // map of id -> webview panel
  private readonly _panelViewType: string = "CosmosDB.GraphExplorer";

  constructor(private _context: vscode.ExtensionContext) {

  }

  public async showGraphViewer(
    tabTitle: string,
    config: GraphConfiguration
  ): Promise<void> {
    let id = await this.getOrCreateServer(config);

    let existingPanel: vscode.WebviewPanel = this._panels.get(id);
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
      localResourceRoots: [vscode.Uri.file(this._context.extensionPath)]
    };
    const panel = vscode.window.createWebviewPanel(this._panelViewType, tabTitle, { viewColumn: column, preserveFocus: true }, options);
    let contentProvider = new WebviewContentProvider(this, this._context);
    panel.webview.html = await contentProvider.provideHtmlContent(id);
    this._panels.set(id, panel);
    panel.onDidDispose(
      // dispose the server
      () => {
        let server = this._servers.get(id);
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

    let server = new GraphViewServer(config);
    await server.start();

    this._lastServerId += 1;
    let id = this._lastServerId;
    this._servers.set(id, server);
    return id;
  }

}

class WebviewContentProvider {
  public onDidChange?: vscode.Event<vscode.Uri>;

  public constructor(private _serverProvider: IServerProvider, private _context: vscode.ExtensionContext) { }

  public async provideHtmlContent(serverId: number): Promise<string> {
    console.assert(serverId > 0);
    let server = this._serverProvider.findServerById(serverId);
    if (server) {
      return await this._graphClientHtmlAsString(server.port);
    }

    throw new Error("This resource is no longer available.");
  }

  private async _graphClientHtmlAsString(port: number): Promise<string> {
    const graphClientAbsolutePath = path.join(resourcesPath, 'graphClient', 'graphClient.html');
    let htmlContents: string = await fse.readFile(graphClientAbsolutePath, 'utf8');
    const portPlaceholder: RegExp = /clientPort/g;
    htmlContents = htmlContents.replace(portPlaceholder, String(port));
    const uriPlaceholder: RegExp = /BASEURI/g;
    let uri = vscode.Uri.parse(path.join("file:" + this._context.extensionPath));
    const baseUri = `vscode-resource:${uri.fsPath}`;
    htmlContents = htmlContents.replace(uriPlaceholder, baseUri);

    return htmlContents;
  }

}
