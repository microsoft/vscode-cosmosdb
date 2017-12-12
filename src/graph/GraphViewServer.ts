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
import { removeDuplicatesById } from "../utils/array";
import { GraphViewServerSocket } from "./GraphViewServerSocket";
import { Socket } from 'net';
import { callWithTelemetry } from '../utils/telemetry';

class GremlinParseError extends Error {
  constructor(err: Error) {
    super(err.message);
  }
}

class EdgeQueryError extends Error { }

function truncateWithEllipses(s: string, maxCharacters) {
  if (s && s.length > maxCharacters) {
    return `${s.slice(0, maxCharacters)}...`;
  }

  return s;
}

function truncateQuery(query: string) {
  return truncateWithEllipses(query, 100);
}

/**
 * @class GraphViewServer This is the server side of the graph explorer. It handles all communications
 * with Azure including gremlin queries. It communicates with the client code via an HTTP server and
 * sockets.
 */
export class GraphViewServer extends EventEmitter {
  private _server: SocketIO.Server;
  private _httpServer: http.Server;
  private _port: number | undefined;
  private _socket: GraphViewServerSocket;
  private _previousPageState: {
    query: string | undefined,
    results: GraphResults | undefined,
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
        this._socket = new GraphViewServerSocket(socket);
        this.setUpSocket();
      });

      this._server.on('error', socket => {
        console.error("Error from server");
      });
    });
  }

  private get maxVertices(): number {
    return Math.max(1, vscode.workspace.getConfiguration().get<number>('cosmosDB.graph.maxVertices'));
  }

  private get maxEdges(): number {
    return Math.max(1, vscode.workspace.getConfiguration().get<number>('cosmosDB.graph.maxEdges'));
  }

  private async queryAndShowResults(queryId: number, gremlinQuery: string): Promise<void> {
    var results: GraphResults | undefined;
    const start = Date.now();

    try {
      await callWithTelemetry("cosmosDB.gremlinQuery", async (telemetryProperties, measurements) => {
        this._previousPageState.query = gremlinQuery;
        this._previousPageState.results = undefined;
        this._previousPageState.errorMessage = undefined;
        this._previousPageState.isQueryRunning = true;
        this._previousPageState.runningQueryId = queryId;

        measurements.gremlinLength = gremlinQuery.length;
        measurements.approxGremlinSteps = gremlinQuery.match("[.]").length;
        telemetryProperties.isDefaultQuery = gremlinQuery === "g.V()" ? "true" : "false";

        // Full query results - may contain vertices and/or edges and/or other things
        var fullResults = await this.executeQuery(queryId, gremlinQuery);
        measurements.mainQueryDuration = (Date.now() - start) / 1000;
        const edgesStart = Date.now();

        let vertices = this.getVertices(fullResults);
        let { limitedVertices, countUniqueVertices } = this.limitVertices(vertices);
        results = {
          fullResults,
          countUniqueVertices: countUniqueVertices,
          limitedVertices: limitedVertices,
          countUniqueEdges: 0, // Fill in later
          limitedEdges: []     // Fill in later
        };
        measurements.countUniqueVertices = countUniqueVertices;
        measurements.limitedVertices = limitedVertices.length;
        this._previousPageState.results = results;

        if (results.limitedVertices.length) {
          try {
            // If it returned any vertices, we need to also query for edges
            var edges = await this.queryEdges(queryId, results.limitedVertices);
            let { countUniqueEdges, limitedEdges } = this.limitEdges(limitedVertices, edges);

            results.countUniqueEdges = countUniqueEdges;
            results.limitedEdges = limitedEdges;
            measurements.countUniqueEdges = countUniqueEdges;
            measurements.limitedEdges = limitedEdges.length;
            measurements.edgesQueryDuration = (Date.now() - edgesStart) / 1000;
          } catch (edgesError) {
            throw new EdgeQueryError(`Error querying for edges: ${edgesError.message || edgesError}`);
          }
        }
      });
    } catch (error) {
      // If there's an error, send it to the client to display
      var message = this.removeErrorCallStack(error.message || error.toString());
      this._previousPageState.errorMessage = message;
      this._socket.emitToClient("showQueryError", queryId, message);
      return;
    } finally {
      this._previousPageState.isQueryRunning = false;
    }

    this._socket.emitToClient("showResults", queryId, results);
  }

  private getVertices(queryResults: any[]): GraphVertex[] {
    return queryResults.filter(n => n.type === "vertex" && typeof n.id === "string");
  }

  private limitVertices(vertices: GraphVertex[]): { countUniqueVertices: number, limitedVertices: GraphVertex[] } {
    vertices = removeDuplicatesById(vertices);
    let countUniqueVertices = vertices.length;

    let limitedVertices = vertices.slice(0, this.maxVertices);

    return { limitedVertices, countUniqueVertices };
  }

  private limitEdges(vertices: GraphVertex[], edges: GraphEdge[]): { countUniqueEdges: number, limitedEdges: GraphEdge[] } {
    edges = removeDuplicatesById(edges);

    // Remove edges that don't have both source and target in our vertex list
    let verticesById = new Map<string, GraphVertex>();
    vertices.forEach(n => verticesById.set(n.id, n));
    edges = edges.filter(e => {
      return verticesById.has(e.inV) && verticesById.has(e.outV);
    });

    // This should be the full set of edges applicable to these vertices
    let countUniqueEdges = edges.length;

    // Enforce max limit on edges
    let limitedEdges = edges.slice(0, this.maxEdges);
    return { limitedEdges, countUniqueEdges }
  }

  private async queryEdges(queryId: number, vertices: { id: string }[]): Promise<GraphEdge[]> {
    // Split into multiple queries because they fail if they're too large
    // Each of the form: g.V("id1", "id2", ...).outE().dedup()
    // Picks up the outgoing edges of all vertices, and removes duplicates
    let maxIdListLength = 5000; // Liberal buffer, queries seem to start failing around 14,000 characters

    let idLists: string[] = [];
    let currentIdList = "";

    for (let i = 0; i < vertices.length; ++i) {
      let vertexId = `"${vertices[i].id}"`;
      if (currentIdList.length && currentIdList.length + vertexId.length > maxIdListLength) {
        // Start a new id list
        idLists.push(currentIdList);
        currentIdList = "";
      }
      currentIdList = (currentIdList ? (currentIdList + ",") : currentIdList) + vertexId;
    }
    if (currentIdList.length) {
      idLists.push(currentIdList);
    }

    // Build queries from each list of IDs
    let promises: Promise<any[]>[] = [];
    for (let i = 0; i < idLists.length; ++i) {
      let idList = idLists[i];
      let query = `g.V(${idList}).outE().dedup()`;
      var promise = this.executeQuery(queryId, query);
      promises.push(promise);
    }

    var results = await Promise.all(promises);
    return Array.prototype.concat(...results);
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
      console.error(error);
    }

    return message;
  }

  private async executeQuery(queryId: number, gremlinQuery: string): Promise<any[]> {
    const maxRetries = 3; // original try + this many extra tries
    const retryDurationMs = 1000;
    let iTry = 0;

    while (true) {
      iTry++;

      try {
        if (iTry > 1) {
          this.log(`Retry #${iTry - 1} for query ${queryId}: ${truncateQuery(gremlinQuery)}`);
        }
        return await this._executeQueryCore(queryId, gremlinQuery);
      } catch (err) {
        if (this.isErrorRetryable(err)) {
          if (iTry >= maxRetries) {
            this.log(`Max retries reached for query ${queryId}: ${truncateQuery(gremlinQuery)}`);
          } else {
            continue;
          }
        } else if (this.isParseError(err)) {
          err = new GremlinParseError(err);
        }

        throw err;
      }
    }
  }

  private async _executeQueryCore(queryId: number, gremlinQuery: string): Promise<any[]> {
    this.log(`Executing query #${queryId}: ${truncateQuery(gremlinQuery)}`);

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
          this.log("Error from gremlin server: ", err.message || err.toString());
          reject(new Error(err));
        }
        this.log("Results from gremlin", results);
        resolve(results);
      });
    });
  }

  private isParseError(err: any): boolean {
    if (err.message) {
      return !!err.message.match(/ScriptEvaluationError/);
    }
  }

  private isErrorRetryable(err: any) {
    // Unfortunately the gremlin server aggregates errors so we can't simply query for status
    if (err.message) {
      if (err.message.match(/Status *: *429/) || err.message.match(/RequestRateTooLarge/)) {
        // Query exceeds allocated RUs, we're supposed to try again
        return true;
      }
    }

    return false;
  }

  private handleGetPageState(): void {
    this.log('getPageState');

    if (this._previousPageState.query) {
      this._socket.emitToClient('setPageState', this._previousPageState);
    }
  }

  private handleSetQuery(query: string) {
    this.log('setQuery');
    this._previousPageState.query = query;
  }

  private handleSetView(view: 'graph' | 'json') {
    this.log('setView');
    this._previousPageState.view = view;
  }

  private handleQueryMessage(queryId: number, gremlin: string) {
    this.log(`Query requested: queryId=${queryId}, gremlin="${gremlin}"`);

    this.queryAndShowResults(queryId, gremlin);
  }

  private handleGetTitleMessage() {
    this.log(`getTitle`);
    this._socket.emitToClient('setTitle', `${this._configuration.databaseName} / ${this._configuration.graphName}`);
  }

  private setUpSocket() {
    this._socket.onClientMessage('log', (...args: any[]) => {
      this.log('from client: ', ...args);
    });

    // Handle QueryTitle event from client
    this._socket.onClientMessage('getTitle', () => this.handleGetTitleMessage());

    // Handle query event from client
    this._socket.onClientMessage('query', (queryId: number, gremlin: string) => this.handleQueryMessage(queryId, gremlin));

    // Handle state event from client
    this._socket.onClientMessage('getPageState', () => this.handleGetPageState());

    // Handle setQuery event from client
    this._socket.onClientMessage('setQuery', (query: string) => this.handleSetQuery(query));

    // Handle setView event from client
    this._socket.onClientMessage('setView', (view: 'graph' | 'json') => this.handleSetView(view));
  }

  private log(message, ...args: any[]) {
    // console.log(message, ...args);
  }
}
