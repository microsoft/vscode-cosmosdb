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

  constructor(private _configuration: GraphConfiguration) {
    super();
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
          console.log(`** Server using port ${this._port} for ${this._configuration.endpoint}`);
          resolve();
        });
      this._server = io(this._httpServer);

      this._server.on('connection', socket => { // TODO called multiple times?  what if already a socket?    dispose?
        console.log(`Connected to client ${socket.id}`);
        this._socket = socket;
        this.setUpSocket();
      });

      this._server.on('error', socket => {
        console.log("error"); // TODO
        reject("TODO");
      });
    });
  }

  private async queryAndShowResults(queryId: number, gremlinQuery: string): Promise<void> {
    var results: any[];

    try {
      var vertices = await this.executeQuery(queryId, gremlinQuery);
      results = vertices;

      // If it returned any vertices, we need to also query for edges
      if (vertices.find(v => v.type === "vertex")) {
        try {
          var edges = await this.executeQuery(queryId, gremlinQuery + ".bothE()");
          results = results.concat(edges);
        } catch (edgesError) {
          // Swallow and just return vertices
          console.log("Error querying for edges: ", (edgesError.message || edgesError));
          // TODO telemetry?
        }
      }
    } catch (error) {
      // If there's an error, send it to the client to display
      this._socket.emit("showQueryError", queryId, error.message || error);
      return;
    }

    this._socket.emit("showResults", queryId, results);
  }

  private async executeQuery(queryId: number, gremlinQuery: string): Promise<any[]> {
    console.log(`Executing query #${queryId}: ${gremlinQuery}`);

    const client = gremlin.createClient(
      this._configuration.endpointPort,
      this._configuration.endpoint,
      {
        "session": false,
        "ssl": this._configuration.endpointPort === 443 || this._configuration.endpointPort === 8080,
        "user": `/dbs/${this._configuration.databaseName}/colls/${this._configuration.graphName}`,
        "password": this._configuration.key
      });

    return new Promise<[{}[]]>((resolve, reject) => {
      client.execute(gremlinQuery, {}, (err, results) => {
        if (err) {
          console.error(err);
          reject(new Error(err));
        }
        console.log("Results from gremlin", results);
        resolve(results);
      });
    });
  }

  private handleQueryMessage(queryId: number, gremlin: string) {
    console.log(`Query requested: queryId=${queryId}, gremlin="${gremlin}"`);

    this.queryAndShowResults(queryId, gremlin).then(() => {
      console.log("Query results sent to client");
    }, reason => {
      // TODO
      console.error(reason);
      vscode.window.showErrorMessage(reason.message || reason);
    });
  }

  private handleGetTitleMessage() {
    console.log(`getTitle`);
    this._socket.emit('setTitle', `${this._configuration.databaseName} / ${this._configuration.graphName}`);
  }

  private setUpSocket() {
    // TODO clean up?
    this._socket.on('log', (...args: any[]) => {
      console.log('from client: ', ...args);
    });

    // HANDLE QUERYTITLE EVENT FROM CLIENT
    this._socket.on('getTitle', () => this.handleGetTitleMessage());

    // HANDLE QUERY EVENT FROM CLIENT
    this._socket.on('query', (queryId: number, gremlin: string) => this.handleQueryMessage(queryId, gremlin));
  }
}
