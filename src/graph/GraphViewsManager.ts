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

// const scheme = "vscode-cosmosdb-graphresults";
// const previewBaseUri = scheme + '://results/';

interface IServerProvider {
  findServerById(id: number): GraphViewServer;
}

interface IGraphClientHtmlPaths {
  d3Uri: string;
  socketUri: string;
  graphClientUri: string;
  cosmosIconUri: string;
  cssUri: string;
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

    let existingPanel: vscode.WebviewPanel;
    this._panels.get(id);
    if (existingPanel) {
      try { //existing panel might have been disposed
        existingPanel.reveal();
        return;
      } catch (_e) {
        //empty block
      }
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
      let options: IGraphClientHtmlPaths = {
        d3Uri: this._getVscodeResourceUri(['dist', 'node_modules', 'd3', 'd3.js']),
        socketUri: this._getVscodeResourceUri(['dist', 'node_modules', 'socket.io-client', 'dist', 'socket.io.js']),
        graphClientUri: this._getVscodeResourceUri(['dist', 'graphClient.js']),
        cosmosIconUri: this._getVscodeResourceUri(['resources', 'cosmos.png']),
        cssUri: this._getVscodeResourceUri(['resources', 'graphClient', 'graphClient.css'])
      };
      return await this._graphClientHtmlAsString(server.port, options);
    }

    throw new Error("This resource is no longer available.");
  }

  private _getVscodeResourceUri(directoryList: string[]): string {
    let uri = vscode.Uri.parse(path.join("file:" + this._context.extensionPath, ...directoryList));
    return `vscode-resource:${uri.fsPath}`;
  }

  private async _graphClientHtmlAsString(port: number, options: IGraphClientHtmlPaths): Promise<string> {
    const graphClientAbsolutePath = path.join(resourcesPath, 'graphClient', 'graphClient.html');
    let htmlContents: string = await fse.readFile(graphClientAbsolutePath, 'utf8');
    // the html has placeholders for the local resource URI's and the port. Replace them
    for (let uriProp of Object.keys(options)) {
      htmlContents = htmlContents.replace(uriProp, options[uriProp]);
    }
    const portPlaceholder: RegExp = /clientPort/g;
    htmlContents = htmlContents.replace(portPlaceholder, String(port));

    return htmlContents;
  }

}
