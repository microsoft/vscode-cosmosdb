/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'events';
import * as http from 'http';
import * as vscode from 'vscode';
import * as path from "path";
import * as io from 'socket.io';
import * as fs from "fs";
import { GraphConfiguration, areConfigsEquals } from './GraphConfiguration';
import { GraphViewServer } from './GraphViewServer';

const scheme = "vscode-cosmosdb-graphresults";
const previewUri = scheme + '://';

export class GraphViewsManager {
  private _lastServerId = 0;
  private _serversMap = new Map<number, GraphViewServer>(); // id -> map

  public constructor(private _context: vscode.ExtensionContext) {
    let documentProvider = new GraphViewDocumentContentProvider();
    let registration = vscode.workspace.registerTextDocumentContentProvider(scheme, documentProvider);
    this._context.subscriptions.push(registration);
  }

  public async showGraphViewer(
    tab: string,
    title: string,
    config: GraphConfiguration
  ): Promise<void> {
    try {
      var server = await this.getServer(config);
      await vscode.commands.executeCommand('vscode.previewHtml', vscode.Uri.parse(previewUri /*asdf + id*/), vscode.ViewColumn.One, tab);
    } catch (error) {
      vscode.window.showErrorMessage(error.message || error); // asdf
    }
  }

  private async getServer(config: GraphConfiguration): Promise<GraphViewServer> {
    var existingServer: GraphViewServer = null;
    this._serversMap.forEach(server => {
      if (areConfigsEquals(server.configuration, config)) {
        existingServer = server;
      }
    })
    if (existingServer) {
      return Promise.resolve(existingServer);
    }

    var server = new GraphViewServer(config);
    await server.start();

    this._lastServerId += 1;
    this._serversMap.set(this._lastServerId, server);
    return server;
  }
}

class GraphViewDocumentContentProvider implements vscode.TextDocumentContentProvider {
  public onDidChange?: vscode.Event<vscode.Uri>;

  public provideTextDocumentContent(uri: vscode.Uri, token: vscode.CancellationToken): vscode.ProviderResult<string> {
    var outPath = path.join(path.dirname(module.filename), "../..");
    var clientHtmlPath = path.join(outPath, "../resources/graphClient/graphClient.html");
    console.assert(fs.existsSync(clientHtmlPath), `Couldn't find ${clientHtmlPath}`);

    var html = `
    <!DOCTYPE html>
    <html>
      <body>
        <iframe src="$$FRAMESRC$$" width="100%" height="1000px" style="border:0"></iframe>
      </body>
    </html>
    `;

    var modifiedHtml = html.replace("$$FRAMESRC$$", clientHtmlPath);
    return modifiedHtml;
  }
}
