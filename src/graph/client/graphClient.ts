import { error } from "util";

/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Do not add any imports do this file, they will not work since they're not hosted in a Node.js process.
 * Dependencies must be added to graphClient.html as script includes.
 *
 * Client code should be kept small.
 */

declare let d3: any;

const animationStepMs = 50; // TODO: optimize.  Slow down ticks?
const graphWidth = 1200, graphHeight = 500; //TODO: be resizable or adapt to editor size
const defaultQuery = "g.V()";

let htmlElements: {
  debugLog: HTMLTextAreaElement,
  jsonResults: HTMLTextAreaElement,
  jsonSection: HTMLDivElement,
  graphSection: HTMLDivElement,
  queryError: HTMLTextAreaElement,
  queryInput: HTMLInputElement,
  title: HTMLElement,
  graphRadio: HTMLInputElement,
  jsonRadio: HTMLInputElement
};

type State = "empty" | "querying" | "error" | "json-results" | "graph-results";

window.onerror = (message) => {
  logToUI("ERROR: " + message);
};

function logToUI(s: string) {
  console.log(s);
  // let v = htmlElements.debugLog.value;
  // v += "\r\n" + s;
  // htmlElements.debugLog.value = v;
}

// results may not be nodes
interface ResultNode {
  [key: string]: any;
  type: "vertex" | "edge";
};

interface ResultEdge extends ResultNode {
  source: number;
  target: number;
};

interface ResultVertex extends ResultNode {
};

export class GraphClient {
  private _socket: SocketIOClient.Socket;
  private _force: any;
  private _currentQueryId = 0;
  private _graphView: boolean;

  private selectById<T extends HTMLElement>(id: string): T {
    let elem = <T>d3.select(`#${id}`)[0][0];
    console.assert(!!elem, `Could not find element with ID ${id}`)
    return elem;
  }

  constructor(port: number) {
    htmlElements = {
      debugLog: this.selectById("debugLog"),
      jsonSection: this.selectById("jsonSection"),
      graphSection: this.selectById("graphSection"),
      jsonResults: this.selectById("jsonResults"),
      queryError: this.selectById("queryError"),
      queryInput: this.selectById("queryInput"),
      title: this.selectById("title"),
      graphRadio: this.selectById("graphRadio"),
      jsonRadio: this.selectById("jsonRadio")
    };

    htmlElements.queryInput.value = defaultQuery;

    this.setStateEmpty();

    this.log(`Connecting on port ${port}`);
    this._socket = io.connect(`http://localhost:${port}`);

    setInterval(() => {
      this.log(`Client heartbeat on port ${port}: ${Date()}`);
    }, 10000);

    this._socket.on('connect', () => {
      this.log(`Client connected on port ${port}`);
      this._socket.emit('getTitle');
    });

    this._socket.on('disconnect', () => {
      this.log("disconnect");
    });

    this._socket.on('setPageState', (query: string, errorMsg: string, results: any[], view: string) => {
      htmlElements.queryInput.value = query;
      if (!errorMsg) {
        this.showResults(results);

        if (view === 'json') {
          this.selectJsonView();
        } else {
          this.selectGraphView();
        }
      } else {
        this.setStateError(errorMsg);
      }
    });

    this._socket.on('setTitle', (title: string) => {
      this.log(`Received title: ${title}`);
      d3.select(htmlElements.title).text(title);
    });

    this._socket.on('showResults', (queryId: number, results: any[]) => {
      this.log(`Received results for query ${queryId} - ${results.length} data points`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring results, out of date");
      } else {
        this.showResults(results);
      }
    });

    this._socket.on('showQueryError', (queryId: number, error: string) => {
      this.log(`Received error for query ${queryId} - ${error}`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring error, out of date");
      } else {
        this.setStateError(error);
      }
    });
  }

  public getPageState() {
    this.emitToHost('state');
  }

  public query(gremlin: string) {
    this._currentQueryId += 1;
    this.emitToHost("query", this._currentQueryId, gremlin);

    this.setStateQuerying();
  }

  public selectGraphView() {
    this._graphView = true;
    this.setView();
  }

  public selectJsonView() {
    this._graphView = false;
    this.setView();
  }

  public setQuery(query: string) {
    this.emitToHost('setQuery', query);
  }

  private setView() {
    htmlElements.graphRadio.checked = this._graphView;
    htmlElements.jsonRadio.checked = !this._graphView;
    d3.select(htmlElements.graphSection).classed("active", this._graphView);
    d3.select(htmlElements.jsonSection).classed("active", !this._graphView);
    this.emitToHost('setView', this._graphView ? 'graph' : 'json');
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

  private setStateEmpty() {
    this._setState("empty");
  }

  private setStateQuerying() {
    this._setState("querying");
    this.clearGraph();
  }

  private setStateResults(hasGraph: boolean) {
    this._setState(hasGraph ? "graph-results" : "json-results");
  }

  private setStateError(error: any) {
    let message: string = error.message || error.toString();
    htmlElements.queryError.value = message;
    this._setState("error");
    this.clearGraph();
  }

  private _setState(state: State) { // TODO: remove?
    let fullState = `state-${state}`;
    switch (state) {
      case "graph-results":
      case "json-results":
        fullState += " state-results";
    }

    d3.select("#states").attr("class", fullState);
  }

  private showResults(nodes: any[]) {
    // Always show JSON results
    htmlElements.jsonResults.value = JSON.stringify(nodes, null, 2);

    let [vertices, edges] = this.splitVerticesAndEdges(nodes);
    if (!vertices.length) {
      // No vertices to show, just show JSON
      this.setStateResults(false);
      return false;
    }

    this.setStateResults(true);
    this.displayGraph(vertices, edges);
    return true;
  }

  private splitVerticesAndEdges(nodes: any[]): [ResultVertex[], ResultEdge[]] {
    let vertices = nodes.filter(n => n.type === "vertex");
    let edges = nodes.filter(n => n.type === "edge");
    return [vertices, edges];
  }

  private clearGraph(): void {
    d3.select(htmlElements.graphSection).select("svg").remove();
  }

  // TODO: Move graphics into another file
  private displayGraph(vertices: ResultVertex[], edges: ResultEdge[]) {
    try {
      this.clearGraph();

      edges = [];
      if (!edges.length) { // TODO: Temporary hack
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

      // Set up force simulation
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

      let svg = d3.select(htmlElements.graphSection).append("svg")
        .attr("width", graphWidth).attr("height", graphHeight);

      // Allow user to drag/zoom the entire SVG
      svg = svg
        .call(d3.behavior.zoom().on("zoom", function () {
          svg.attr("transform", "translate(" + d3.event.translate + ")" + " scale(" + d3.event.scale + ")")
        }))
        .append("g");

      // Edges before vertices so that edges don't get drawn on top of vertices, obscuring them
      let edge = svg.selectAll(".edge")
        .data(edges)
        .enter().append("line")
        .attr("class", "edge")
        ;

      // Allow user to drag vertices. Set "dragging" class while dragging.
      let vertexDrag = force.drag().on("dragstart", function () {
        d3.select(this).classed("dragging", true);

        // Keep a drag from also starting a zoom action
        d3.event.sourceEvent.stopPropagation();
      })
        .on("dragend", function () { d3.select(this).classed("dragging", false); });

      let label = svg.selectAll(".label")
        .data(vertices)
        .enter().append("text")
        .attr("class", "label")
        .attr("x", "10px")
        .attr("y", "2px")
        .attr('font-size', 13)
        .text(function (d) {
          let displayText = d.id; // TODO: allow user to change what property we display
          return displayText;
        })
        ;

      // Vertices last so that they're always and top to be able to be dragged
      let vertex = svg.selectAll(".vertex")
        .data(vertices)
        .enter().append("circle")
        .attr("class", "vertex")
        .attr("cx", function (d) { return d.x; })
        .attr("cy", function (d) { return d.y; })
        .call(vertexDrag)
        ;

      force.on("tick", () => {
        // The force engine has recalculated x and y for each vertex and edge, so
        // move them in the SVG to those new positions.

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
  }
}
