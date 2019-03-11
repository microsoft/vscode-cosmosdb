/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as vscode from 'vscode';
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
    this._panels.forEach((p, key) => {
      if (key === id) {
        existingPanel = p;
      }
    });
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
    panel.webview.html = contentProvider.provideHtmlContent(id);
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

  public findPanelById(id: number): vscode.WebviewPanel {
    return this._panels.get(id);
  }

}

class WebviewContentProvider {
  public onDidChange?: vscode.Event<vscode.Uri>;

  public constructor(private _serverProvider: IServerProvider, private _context: vscode.ExtensionContext) { }

  public provideHtmlContent(serverId: number): string {
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
      return this._graphClientHtmlAsString(server.port, options);
    }

    return "This resource is no longer available.";
  }

  private _getVscodeResourceUri(directoryList: string[]): string {
    let uri = vscode.Uri.parse(path.join("file:" + this._context.extensionPath, ...directoryList));
    return `vscode-resource:${uri.fsPath}`;
  }

  private _graphClientHtmlAsString(port: number, options: IGraphClientHtmlPaths): string {
    return `
    <!DOCTYPE html>
    <html>

    <!--
    *  Copyright (c) Microsoft Corporation. All rights reserved.
    *  Licensed under the MIT License. See License.txt in the project root for license information.
    *-->

    <!--
        This is the HTML for exploring graphs, and is hosted inside a WebView in a VS HTML preview window
    -->

    <head>
        <link rel="stylesheet" type="text/css" href="${options.cssUri}">
        </link>

        <script src='${options.d3Uri}' charset="UTF-8"></script>

        <script>window.exports = {};</script>
        <script src="${options.socketUri}"></script>
        <script>
            io = exports.io;
        </script>

        <script src="${options.graphClientUri}"></script>
    </head>

    <!-- Possible states (set on #states - see "type State" in graphClient.ts)
        state-initial   (just loaded - user needs to do a query)
        state-querying
        state-error
        // The following have multiple classes set on the #states element:
        state-results + state-graph-results
        state-results + state-json-results state-non-graph-results
        state-results + state-json-results state-empty-results
    -->

    <body>
        <div id="states" class="state-initial">
            </script>
            <header>
                <img id="cosmos" src="${options.cosmosIconUri}">
                <h1 id="title">
                    &nbsp;
                    <!-- placeholder -->
                </h1>
            </header>

            <div>
                <div>
                    <input id="queryInput" type="text" placeholder='Enter gremlin query ("g.V()" for all vertices)'></input>
                    <button id="executeButton" onclick="onExecuteClick()">Execute</button>
                </div>
            </div>

            <div id="radioButtons" class="toggle-radio-buttons">
                <input type="radio" id="graphRadio" name="resultsToggle" value="graph" checked onclick="selectGraphView()">
                <label for="graphRadio">Graph</label>
                <input type="radio" id="jsonRadio" name="resultsToggle" value="json" onclick="selectJsonView()">
                <label for="jsonRadio">JSON</label>
            </div>

            <div id="resultsBackground" width="100%">
                <textarea id="queryError" class="error" readonly="readonly" width="100%"></textarea>
                <div id="resultsSection">
                    <div id="graphSection" class="active">
                        <svg>
                            <defs></defs>
                        </svg>
                        <div id="graphWatermark" class="watermark">
                            <div id="nonGraphResults">
                                The results cannot be displayed visually. Please see the JSON tab for detailed results.
                            </div>
                            <div id="emptyResults">
                                The returned results are empty. Please enter a query and click Execute.
                            </div>
                        </div>
                    </div>
                    <div id="jsonSection">
                        <textarea id="jsonResults"></textarea>
                    </div>
                </div>
                <div id="initialWatermark" class="watermark">
                    No data has been loaded. Please enter a query and click Execute.
                </div>
                <div id="queryStatus">Querying...</div>
            </div>
            <div id="statsBackground">
                <div id="stats"></div>
            </div>


            <div id="debug" style="display:none">
                <h2>Debug log</h2>
                <textarea id="debugLog"></textarea>
            </div>

            <script>
                // Retrieve port from query string
                var graphClient = new GraphClient(${port});

                window.onload = () => {
                    graphClient.getPageState();
                    graphClient.copyParentStyleSheets();
                }

                queryInput.onchange = () => {
                    graphClient.setQuery(queryInput.value);
                };

                function onExecuteClick() {
                    graphClient.query(queryInput.value);
                }

                function selectGraphView() {
                    graphClient.selectGraphView();
                }

                function selectJsonView() {
                    graphClient.selectJsonView();
                }

                document.getElementById("queryInput").addEventListener("keydown", function (e) {
                    if (e.keyCode === 13 /* enter */) {
                        onExecuteClick();
                    }
                })
            </script>
        </div>
    </body>

    </html>
    `;

  }

}
