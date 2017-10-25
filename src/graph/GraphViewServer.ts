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

export class GraphViewServer extends EventEmitter {
  private _server: SocketIO.Server;
  private _httpServer: http.Server;
  private _port: number;
  private _socket: SocketIO.Socket;

  constructor(private _configuration: GraphConfiguration) {
    super();
  }

  public get configuration(): GraphConfiguration {
    return this._configuration;
  }

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
    if (!this._socket) {
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
        57567,//asdf // use any unused port
        () => {
          this._port = this._httpServer.address().port;
          console.log(`Using port ${this._port}`);
          resolve();
        });
      this._server = io(this._httpServer);

      this._server.on('connection', socket => { // asdf called multiple times?  what if already a socket?    dispose?
        console.log(`Connected to client ${socket.id}`);
        this._socket = socket;
        this.setUpSocket();
      });

      this._server.on('error', socket => {
        console.log("error"); // asdf
        reject("asdf");
      });
    });
  }

  private async queryAndShowResults(queryId: number, gremlinQuery: string): Promise<void> {
    var results: GraphNode[];

    try {
      var vertices = await this.executeQuery(queryId, gremlinQuery);
      var edges = await this.executeQuery(queryId, gremlinQuery + ".bothE()");
      results = vertices.concat(edges);
    } catch (error) {
      this._socket.emit("showQueryError", queryId, error.message || error);
    }

    this._socket.emit("showResults", queryId, results);
  }

  private async executeQuery(queryId: number, gremlinQuery: string): Promise<any[]> {
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
        console.log("results from gremlin", results); // asdf
        console.log();
        resolve(results);
      });
    });
  }

  private setUpSocket() {
    // asdf clean up?
    this._socket.on('log', (...args: any[]) => {
      console.log('from client: ', ...args);
    });

    this._socket.on('query', (queryId: number, gremlin: string) => {
      console.log(`Query requested: queryId=${queryId}, gremlin="${gremlin}"`);

      this.queryAndShowResults(queryId, gremlin).then(() => {
        console.error("query results sent to client"); // asdf
      }, reason => {
        console.error(reason); // asdf
        vscode.window.showErrorMessage(reason.message || reason);
      });
    });
  }
}
