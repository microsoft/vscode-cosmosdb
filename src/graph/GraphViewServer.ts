/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'events';
import * as http from 'http';
import * as vscode from 'vscode';
import * as path from "path";
import * as io from 'socket.io';
import { setInterval } from 'timers';
import { GraphConfiguration } from './GraphConfiguration';
import * as gremlin from "gremlin";

/**
 * @class GraphViewServer This is the server side of the graph explorer. It handles all communications
 * with Azure including gremlin queries. It communicates with the client code via an HTTP server and
 * sockets.
 */
export class GraphViewServer extends EventEmitter {
  private _server: SocketIO.Server;
  private _httpServer: http.Server;
  private _port: number | undefined;
  private _socket: SocketIO.Socket;
  private _previousPageState: {
    query: string | undefined,
    results: any[] | undefined,
    errorMessage: string | undefined,
    view: 'graph' | 'json',
    isQueryRunning: boolean,
    runningQueryId: number
  };


  constructor(private _configuration: GraphConfiguration) {
    super();
    this._previousPageState = {
      query: undefined,
      results: undefined,
      errorMessage: undefined,
      view: 'graph',
      isQueryRunning: false,
      runningQueryId: 0
    };
  }

  public get configuration(): GraphConfiguration {
    return this._configuration;
  }

  // TODO: vscode.Disposable
  public dispose() {
    if (this._socket) {
      this._socket.disconnect();
      this._socket = null;
    }
    if (this._httpServer) {
      this._httpServer.close();
      this._httpServer = null;
    }
    if (this._server) {
      this._server.close();
      this._server = null;
    }
  }

  public get port(): number {
    if (!this._port) {
      throw new Error("Server has not started");
    }

    return this._port;
  }

  public start(): Promise<void> {
    if (this._socket) {
      return Promise.resolve();
    }

    // how know resolve/reject?
    return new Promise((resolve, reject) => {
      this._httpServer = http.createServer()
      this._httpServer.listen(
        0, // dynamnically pick an unused port
        () => {
          this._port = this._httpServer.address().port;
          console.log(`** GraphViewServer listening to port ${this._port} for ${this._configuration.endpoint}`);
          resolve();
        });
      this._server = io(this._httpServer);

      this._server.on('connection', socket => {
        this.log(`Connected to client ${socket.id}`);
        this._socket = socket;
        this.setUpSocket();
      });

      this._server.on('error', socket => {
        this.log("Error from server");
      });
    });
  }

  private async queryAndShowResults(queryId: number, gremlinQuery: string): Promise<void> {
    var results: any[];

    try {
      this._previousPageState.query = gremlinQuery;
      this._previousPageState.results = undefined;
      this._previousPageState.errorMessage = undefined;
      this._previousPageState.isQueryRunning = true;
      this._previousPageState.runningQueryId = queryId;
      var vertices = await this.executeQuery(queryId, gremlinQuery);
      results = vertices;

      // If it returned any vertices, we need to also query for edges
      if (vertices.find(v => v.type === "vertex")) {
        try {
          var edges = await this.executeQuery(queryId, gremlinQuery + ".bothE()");
          results = results.concat(edges);
          this._previousPageState.results = results;
        } catch (edgesError) {
          // Swallow and just return vertices
          this.log("Error querying for edges: ", (edgesError.message || edgesError));
        }
      }
    } catch (error) {
      // If there's an error, send it to the client to display
      var message = this.removeErrorCallStack(error.message || error.toString());
      this._previousPageState.errorMessage = message;
      this._socket.emit("showQueryError", queryId, message);
      return;
    } finally {
      this._previousPageState.isQueryRunning = false;
    }

    this._socket.emit("showResults", queryId, results);
  }

  private removeErrorCallStack(message: string): string {
    // Remove everything after the lines start looking like this:
    //      at Microsoft.Azure.Graphs.GremlinGroovy.GremlinGroovyTraversalScript.TranslateGroovyToCsharpInner()
    try {
      var match = message.match(/^\r?\n?\s*at \S+\(\)\s*$/m);
      if (match) {
        return message.slice(0, match.index);
      }
    } catch (error) {
      // Shouldn't happen, just being defensive
    }

    return message;
  }

  private async executeQuery(queryId: number, gremlinQuery: string): Promise<any[]> {
    this.log(`Executing query #${queryId}: ${gremlinQuery}`);

    const client = gremlin.createClient(
      this._configuration.endpointPort,
      this._configuration.endpoint,
      {
        "session": false,
        "ssl": this._configuration.endpointPort === 443 || this._configuration.endpointPort === 8080,
        "user": `/dbs/${this._configuration.databaseName}/colls/${this._configuration.graphName}`,
        "password": this._configuration.key
      });

    // Patch up handleProtocolMessage as a temporary work-around for https://github.com/jbmusso/gremlin-javascript/issues/93
    var originalHandleProtocolMessage = client.handleProtocolMessage;
    client.handleProtocolMessage = function handleProtocolMessage(message) {
      if (!message.binary) {
        // originalHandleProtocolMessage isn't handling non-binary messages, so convert this one back to binary
        message.data = new Buffer(message.data);
        message.binary = true;
      }

      originalHandleProtocolMessage.call(this, message);
    };

    return new Promise<[{}[]]>((resolve, reject) => {
      client.execute(gremlinQuery, {}, (err, results) => {
        if (err) {
          this.log("Error from gremlin: ", err.message || err.toString());
          reject(new Error(err));
        }
        this.log("Results from gremlin", results);
        resolve(results);
      });
    });
  }

  private handleGetPageState() {
    console.log('getPageState');

    if (this._previousPageState.query) {
      this._socket.emit('setPageState', this._previousPageState);
    }
  }

  private handleSetQuery(query: string) {
    console.log('setQuery');
    this._previousPageState.query = query;
  }

  private handleSetView(view: 'graph' | 'json') {
    console.log('setView');
    this._previousPageState.view = view;
  }

  private handleQueryMessage(queryId: number, gremlin: string) {
    this.log(`Query requested: queryId=${queryId}, gremlin="${gremlin}"`);

    this.queryAndShowResults(queryId, gremlin);
  }

  private handleGetTitleMessage() {
    this.log(`getTitle`);
    this._socket.emit('setTitle', `${this._configuration.databaseName} / ${this._configuration.graphName}`);
  }

  private setUpSocket() {
    // TODO clean up?
    this._socket.on('log', (...args: any[]) => {
      this.log('from client: ', ...args);
    });

    // Handle QueryTitle event from client
    this._socket.on('getTitle', () => this.handleGetTitleMessage());

    // Handle query event from client
    this._socket.on('query', (queryId: number, gremlin: string) => this.handleQueryMessage(queryId, gremlin));

    // Handle state event from client
    this._socket.on('getPageState', () => this.handleGetPageState());

    // Handle setQuery event from client
    this._socket.on('setQuery', (query: string) => this.handleSetQuery(query));

    // Handle setView event from client
    this._socket.on('setView', (view: 'graph' | 'json') => this.handleSetView(view));
  }

  private log(message, ...args: any[]) {
  }
}
