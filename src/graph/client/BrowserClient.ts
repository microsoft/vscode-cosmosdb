/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare let d3: any; // asdf

let animationStepMs = 300; //asdf
let graphWidth = 1200, graphHeight = 500; //asdf

let debugLog: HTMLTextAreaElement;
let jsonResults: HTMLTextAreaElement;
let jsonDiv: HTMLDivElement;
let graphDiv: HTMLDivElement;
let queryError: HTMLTextAreaElement;
let queryStatus: HTMLLabelElement;

window.onerror = (message) => {
  logToUI("ERROR: " + message);
};

function logToUI(s: string) {
  console.log(s);
  let v = debugLog.value;
  v += "\r\n" + s;
  debugLog.value = v;
}

// asdf results may not be nodes
interface GraphNode {
  [key: string]: any;
  type: "vertex" | "edge";
};

interface GraphEdge extends GraphNode {
  source: number;
  target: number;
};

interface GraphVertex extends GraphNode {
};

class BrowserClient { // asdf multiple getting created?
  private _socket: SocketIOClient.Socket;
  private _force: any;
  private _currentQueryId = 0;

  private selectById<T extends HTMLElement>(id: string): T {
    let elem = <T>d3.select(`#${id}`)[0][0];
    console.assert(!!elem, `Could not find element with ID ${id}`)
    return elem;
  }

  constructor(port: number) {
    debugLog = this.selectById("debugLog")
    jsonDiv = this.selectById("json");
    graphDiv = this.selectById("graph");
    jsonResults = this.selectById("jsonResults");
    queryError = this.selectById("queryError");
    queryStatus = this.selectById("queryStatus")

    this.log(`Connecting on port ${port}`);
    this._socket = io.connect(`http://localhost:${port}`);

    setInterval(() => {
      this.log(`Client heartbeat on port ${port}: ${Date()}`);
    }, 5000);

    this._socket.on('connect', () => {
      this.log(`Client connected on port ${port}`);
    });

    this._socket.on('disconnect', () => {
      this.log("disconnect");
    });

    this._socket.on('showResults', (queryId: number, results: any[]) => {
      this.log(`Received results for query ${queryId} - ${results.length} data points`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring results, out of date");
      } else {
        this.showProgressIndicator(false);
        this.showError(null);

        this.showJson(JSON.stringify(results, null, 2));
        this.displayGraph(results);
      }
    });

    this._socket.on('showQueryError', (queryId: number, error: string) => {
      this.log(`Received error for query ${queryId} - ${error}`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring error, out of date");
      } else {
        this.showError(error);
        this.showProgressIndicator(false);
      }
    });
  }

  public query(gremlin: string) {
    this._currentQueryId += 1;
    this.emitToHost("query", this._currentQueryId, gremlin);

    this.showProgressIndicator(true);
    this.showError(null);
  }

  private emitToHost(message: string, ...args: any[]) {
    logToUI("Message to host: " + message + " " + args.join(", "));
    this._socket.emit(message, ...args);
  }

  private log(s: string) {
    if (this._socket) {
      this.emitToHost('log', s);
    }

    logToUI(s);
  }

  private showProgressIndicator(f: boolean) {
    d3.select(queryStatus).classed("working", f);
  }

  private showError(error: any) {
    let message: string = error ? (error.message || error.toString()) : error;
    d3.select(queryError).classed("hidden", !error);
    queryError.value = message;
  }

  private showJson(json: string) {
    d3.select(jsonDiv).classed("hidden", !json);
    jsonResults.value = json;
  }

  private showGraph(f: boolean) {
    d3.select(graphDiv).classed("hidden", !f);
  }

  private splitVerticesAndEdges(nodes: any[]): [GraphVertex[], GraphEdge[]] {
    let vertices = nodes.filter(n => n.type === "vertex");
    let edges = nodes.filter(n => n.type === "edge");
    return [vertices, edges];
  }

  private displayGraph(nodes: any[]) {
    this.showProgressIndicator(true);
    try {
      // Clear current results
      d3.select(graphDiv).select("svg").remove();

      let [vertices, edges] = this.splitVerticesAndEdges(nodes);
      if (!vertices.length) {
        // No vertices to show, just show JSON
        this.showGraph(false);
        return;
      }

      edges = [];
      if (!edges.length) { //asdf
        for (var i = 0; i < vertices.length; ++i) {
          edges.push({
            type: "edge",
            source: Math.floor(Math.random() * vertices.length),
            target: Math.floor(Math.random() * vertices.length)
          })
        }
      }

      // edges.forEach((e, i) => {
      //   e.source = i;
      //   e.target = i + 1;
      // });
      let svg = d3.select(graphDiv).append("svg")
        .attr("width", graphWidth).attr("height", graphHeight);

      this.showGraph(true);

      if (this._force) {
        this._force.stop();
      }

      this._force = d3.layout.force()
        .size([graphWidth, graphHeight])
        .nodes(vertices)
        .links(edges);
      let force = this._force;

      force.gravity(1); // Draws the vertices toward the center of the graph
      force.friction(.5);

      force.linkDistance(graphWidth / 3); // edge length
      force.linkStrength(0.01); // Reduce rigidity of the edges (if < 1, the full linkDistance is relaxed)
      force.charge(-3000);

      // Randomized colors
      //let getColor = d3.scale.category20();

      // Edges before vertices so that edges don't get drawn on top of vertices, obscuring them
      let edge = svg.selectAll(".edge")
        .data(edges)
        .enter().append("line")
        .attr("class", "edge")
        ;

      let vertex = svg.selectAll(".vertex")
        .data(vertices)
        .enter().append("circle")
        .attr("class", "vertex")
        .attr("r", "5px")
        .attr("cx", function (d) { return d.x; })
        .attr("cy", function (d) { return d.y; })
        //.attr("fill", function (d, i) { return getColor(i); })
        ;

      let label = svg.selectAll(".label")
        .data(vertices)
        .enter().append("text")
        .attr("class", "label")
        .attr("x", "7px")
        .attr("y", "2px")
        .attr('font-size', 16)
        .text(function (d) {
          let displayText = d.id; // TODO: allow user to change
          return displayText;
        })
        ;

      force.on("tick", () => {
        // The force engine has recalculated x and y for each vertex and edge, so
        // move them in the SVG to those new positions.

        // asdf slow down ticks?
        // this.log("tick");

        vertex
          .transition().ease("linear").duration(animationStepMs)
          .attr("cx", function (d) { return d.x; })
          .attr("cy", function (d) { return d.y; })

        // Note that the indices in the edges have now been replaced by references to vertices
        edge
          .transition().ease("linear").duration(animationStepMs)
          .attr("x1", function (d) { return d.source.x; })
          .attr("y1", function (d) { return d.source.y; })
          .attr("x2", function (d) { return d.target.x; })
          .attr("y2", function (d) { return d.target.y; });

        label
          .transition().ease("linear").duration(animationStepMs)
          .attr("class", "label")
          .attr("dx", function (d) { return d.x; })
          .attr("dy", function (d) { return d.y; })
      });

      force.start();
    } catch (err) {
      this.log(err);
    }
    finally {
      this.showProgressIndicator(false);
    }
  }
}
