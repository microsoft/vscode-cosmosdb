/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as path from "path";
import * as fs from "fs";
import { GraphConfiguration, areConfigsEqual } from './GraphConfiguration';
import { GraphViewServer } from './GraphViewServer';
import { AzureActionHandler } from 'vscode-azureextensionui';

const scheme = "vscode-cosmosdb-graphresults";
const previewBaseUri = scheme + '://results/';

interface IServerProvider {
  findServerById(id: number): GraphViewServer;
}

export class GraphViewsManager implements IServerProvider {
  private _lastServerId = 0;

  // One server (and one HTML view) per graph, as represented by unique configurations
  private _servers = new Map<number, GraphViewServer>(); // map of id -> map

  public constructor(private _context: vscode.ExtensionContext, private _actionHandler: AzureActionHandler) {
    let documentProvider = new GraphViewDocumentContentProvider(this);
    let registration = vscode.workspace.registerTextDocumentContentProvider(scheme, documentProvider);
    this._context.subscriptions.push(registration);
  }

  public async showGraphViewer(
    tabTitle: string,
    config: GraphConfiguration
  ): Promise<void> {
    try {
      var [id,] = await this.getOrCreateServer(config);

      // Add server ID to the URL so that GraphViewDocumentContentProvider knows which port to use in the HTML
      var serverUri = previewBaseUri + id.toString();
      await vscode.commands.executeCommand('vscode.previewHtml', vscode.Uri.parse(serverUri), vscode.ViewColumn.One, tabTitle);
    } catch (error) {
      vscode.window.showErrorMessage(error.message || error);
    }
  }

  public findServerById(id: number): GraphViewServer {
    return this._servers.get(id);
  }

  private async getOrCreateServer(config: GraphConfiguration): Promise<[number, GraphViewServer]> {
    var existingServer: GraphViewServer = null;
    var existingId: number;
    this._servers.forEach((server, key) => {
      if (areConfigsEqual(server.configuration, config)) {
        existingServer = server;
        existingId = key;
      }
    })
    if (existingServer) {
      return [existingId, existingServer];
    }

    var server = new GraphViewServer(config, this._actionHandler);
    await server.start();

    this._lastServerId += 1;
    var id = this._lastServerId;
    this._servers.set(id, server);
    return [id, server];
  }
}

class GraphViewDocumentContentProvider implements vscode.TextDocumentContentProvider {
  public onDidChange?: vscode.Event<vscode.Uri>;

  public constructor(private _serverProvider: IServerProvider) { }

  public provideTextDocumentContent(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.ProviderResult<string> {
    // Figure out which client to attach this to
    var serverId = parseInt(uri.path.slice(1) /* remove '/' from beginning */);
    console.assert(serverId > 0);
    var server = this._serverProvider.findServerById(serverId);
    if (server) {
      var outPath = path.join(path.dirname(module.filename), "../..");
      var clientHtmlPath = path.join(outPath, "../resources/graphClient/graphClient.html");
      console.assert(fs.existsSync(clientHtmlPath), `Couldn't find ${clientHtmlPath}`);

      var html = `
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

    return "This resource is no longer available."
  }
}
