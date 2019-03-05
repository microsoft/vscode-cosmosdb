/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from "fs";
import * as path from "path";
import * as vscode from 'vscode';
import { resourcesPath } from "../constants";
import { areConfigsEqual, GraphConfiguration } from './GraphConfiguration';
import { GraphViewServer } from './GraphViewServer';

const scheme = "vscode-cosmosdb-graphresults";
const previewBaseUri = scheme + '://results/';

interface IServerProvider {
  findServerById(id: number): GraphViewServer;
}

export class GraphViewsManager implements IServerProvider { //Graphviews Panel
  private _lastServerId = 0;

  // One server (and one HTML view) per graph, as represented by unique configurations
  private _servers = new Map<number, GraphViewServer>(); // map of id -> map
  private _panels = new Map<number, vscode.WebviewPanel>(); // map of id -> map
  private _panelViewType: string = "GraphExplorer";

  public constructor(private _context: vscode.ExtensionContext) {
  }

  public async showGraphViewer(
    tabTitle: string,
    config: GraphConfiguration
  ): Promise<void> {
    try {

      const panel: vscode.WebviewPanel = await this.getOrCreatePanel(config, tabTitle);
      panel.reveal();
      // await vscode.commands.executeCommand('vscode.previewHtml', vscode.Uri.parse(serverUri), vscode.ViewColumn.One, tabTitle);
    } catch (error) {
      vscode.window.showErrorMessage(error.message || error);
    }
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

  public findPanelById(id: number): vscode.WebviewPanel {
    return this._panels.get(id);
  }

  private async getOrCreatePanel(config: GraphConfiguration, tabTitle: string): Promise<vscode.WebviewPanel> {
    let id = await this.getOrCreateServer(config);

    let retpanel: vscode.WebviewPanel;
    this._panels.forEach((p, key) => {
      if (key === id) {
        retpanel = p;
      }
    });
    if (retpanel) {
      return retpanel;
    }
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
    const showOptions: vscode.WebviewOptions & vscode.WebviewPanelOptions = { enableScripts: true, enableCommandUris: true, enableFindWidget: true, retainContextWhenHidden: true };
    const panel = vscode.window.createWebviewPanel(this._panelViewType, tabTitle, { viewColumn: column, preserveFocus: true }, showOptions);
    let documentProvider = new GraphViewDocumentContentProvider(this);
    panel.webview.html = documentProvider.provideHtmlContent(vscode.Uri.parse(id.toString()));
    this._panels.set(id, panel);
    return panel;
  }

}

class GraphViewDocumentContentProvider {
  public onDidChange?: vscode.Event<vscode.Uri>;

  public constructor(private _serverProvider: IServerProvider) { }

  public provideHtmlContent(uri: vscode.Uri): string {
    // Figure out which client to attach this to
    // tslint:disable-next-line:no-single-line-block-comment
    let serverId = parseInt(uri.path.slice(1) /* remove '/' from beginning */, 10);
    console.assert(serverId > 0);
    let server = this._serverProvider.findServerById(serverId);
    if (server) {
      let clientHtmlPath = path.join(resourcesPath, 'graphClient', 'graphClient.html');
      console.assert(fs.existsSync(clientHtmlPath), `Couldn't find ${clientHtmlPath}`);

      let html = `
    <!DOCTYPE html>
    <html>
      <style>
        body {
          padding: 0;
          margin: 0;
        }
      </style>
      <body>
        <iframe src="file://${clientHtmlPath}?port=${server.port}" style="width: 100%; height: 100%; position: absolute; padding: 0; margin: 0; border: none"></iframe>
      </body>
    </html>
    `;

      return html;
    }

    return "This resource is no longer available.";
  }
}
