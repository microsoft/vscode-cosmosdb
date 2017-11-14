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

const animationStepMs = 50;
const graphWidth = 1200, graphHeight = 700;
const defaultQuery = "g.V()";

const linkDistance = graphWidth / 3;
const linkStrength = 0.01; // Reduce rigidity of the links (if < 1, the full linkDistance is relaxed)
const charge = -3000;
const markerDistanceFromVertex = 10;
const vertexRadius = 8; // from css
const paddingBetweenVertexAndEdge = 3;

let htmlElements: {
  debugLog: HTMLTextAreaElement,
  graphRadio: HTMLInputElement,
  graphSection: HTMLDivElement,
  jsonRadio: HTMLInputElement,
  jsonResults: HTMLTextAreaElement,
  jsonSection: HTMLDivElement,
  queryError: HTMLTextAreaElement,
  queryInput: HTMLInputElement,
  stats: HTMLSpanElement,
  title: HTMLElement
};

type State = "empty" | "querying" | "error" | "json-results" | "graph-results";

type PageState = {
  results: Results,
  isQueryRunning: boolean,
  errorMessage?: string,
  query: string,
  view: 'json' | 'graph',
  runningQueryId: number
};

window.onerror = (message) => {
  logToUI("ERROR: " + message);
};

function logToUI(s: string) {
  console.log(s);
  // let v = htmlElements.debugLog.value;
  // v += "\r\n" + s;
  // htmlElements.debugLog.value = v;
}

type Results = {
  fullResults: any[];
  countUniqueVertices: number;
  countUniqueEdges: number;

  // Limited by max
  limitedVertices: Vertex[];
  limitedEdges: Edge[];
};

interface Edge {
  id: string;
  type: "edge";
  inV: string;  // Edge source ID
  outV: string; // Edge target ID
};

interface Vertex {
  id: string;
  type: "edge";
};

interface ForceNode {
  vertex: Vertex;
  x: number;
  y: number;
}

interface ForceLink {
  edge: Edge;
  source: ForceNode;
  target: ForceNode;
}

interface Point2D {
  x: number;
  y: number;
}

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
      stats: this.selectById("stats"),
      title: this.selectById("title"),
      graphRadio: this.selectById("graphRadio"),
      jsonRadio: this.selectById("jsonRadio")
    };

    htmlElements.queryInput.value = defaultQuery;

    this.setStateEmpty();

    this.log(`Connecting on port ${port}`);
    this._socket = io.connect(`http://localhost:${port}`);

    // setInterval(() => {
    //   this.log(`Client heartbeat on port ${port}: ${Date()}`);
    // }, 10000);

    this._socket.on('connect', (): void => {
      this.log(`Client connected on port ${port}`);
      this._socket.emit('getTitle');
    });

    this._socket.on('disconnect', (): void => {
      this.log("disconnect");
    });

    this._socket.on('setPageState', (pageState: PageState) => {
      htmlElements.queryInput.value = pageState.query;

      if (pageState.isQueryRunning) {
        this._currentQueryId = pageState.runningQueryId;
        this.setStateQuerying();
        return;
      }

      if (!pageState.errorMessage) {
        this.showResults(pageState.results);
      } else {
        this.setStateError(pageState.errorMessage);
      }

      if (pageState.view === 'json') {
        this.selectJsonView();
      } else {
        this.selectGraphView();
      }
    });

    this._socket.on('setTitle', (title: string): void => {
      this.log(`Received title: ${title}`);
      d3.select(htmlElements.title).text(title);
    });

    this._socket.on('showResults', (queryId: number, results: Results): void => {
      this.log(`Received results for query ${queryId}`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring results, out of date");
      } else {
        this.showResults(results);
      }
    });

    this._socket.on('showQueryError', (queryId: number, error: string): void => {
      this.log(`Received error for query ${queryId} - ${error}`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring error, out of date");
      } else {
        this.setStateError(error);
      }
    });
  }

  public getPageState() {
    this.emitToHost('getPageState');
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
    d3.select(htmlElements.graphSection).classed("active", !!this._graphView);
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

  private _setState(state: State) {
    let fullState = `state-${state}`;
    switch (state) {
      case "graph-results":
      case "json-results":
        fullState += " state-results";
    }

    d3.select("#states").attr("class", fullState);
  }

  private showResults(results: Results): void {
    // queryResults may contain any type of data, not just vertices or edges

    // Always show the full original results JSON
    htmlElements.jsonResults.value = JSON.stringify(results.fullResults, null, 2);

    if (!results.limitedVertices.length) {
      // No vertices to show, just show query JSON
      this.setStateResults(false);
      return;
    }

    this.setStateResults(true);
    this.displayGraph(results.countUniqueVertices, results.limitedVertices, results.countUniqueEdges, results.limitedEdges);
  }

  private splitVerticesAndEdges(nodes: any[]): [Vertex[], Edge[]] {
    let vertices = nodes.filter(n => n.type === "vertex");
    let edges = nodes.filter(n => n.type === "edge");
    return [vertices, edges];
  }

  private clearGraph(): void {
    d3.select(htmlElements.graphSection).select("svg").selectAll(".vertex, .edge, .label").remove();
  }

  private static calculateClosestPIOver2(angle: number): number {
    const CURVATURE_FACTOR = 40;
    const result = (Math.atan(CURVATURE_FACTOR * (angle - (Math.PI / 4))) / 2) + (Math.PI / 4);
    return result;
  }

  private static calculateClosestPIOver4(angle: number): number {
    const CURVATURE_FACTOR = 100;
    const result = (Math.atan(CURVATURE_FACTOR * (angle - (Math.PI / 8))) / 4) + (Math.PI / 8);
    return result;
  }

  private static calculateControlPoint(start: Point2D, end: Point2D): Point2D {
    const alpha = Math.atan2(end.y - start.y, end.x - start.x);
    const n = Math.floor(alpha / (Math.PI / 2));
    const reducedAlpha = alpha - (n * Math.PI / 2);
    const reducedBeta = GraphClient.calculateClosestPIOver2(reducedAlpha);
    const beta = reducedBeta + (n * Math.PI / 2);

    const length = Math.sqrt((end.y - start.y) * (end.y - start.y) + (end.x - start.x) * (end.x - start.x)) / 2;
    const result = {
      x: start.x + Math.cos(beta) * length,
      y: start.y + Math.sin(beta) * length
    };

    return result;
  }

  private positionLink(l: any) {
    const d1 = GraphClient.calculateControlPoint(l.source, l.target);

    var radius = vertexRadius + paddingBetweenVertexAndEdge;

    // Start
    var dx = d1.x - l.source.x;
    var dy = d1.y - l.source.y;
    var angle = Math.atan2(dy, dx);
    var tx = l.source.x + (Math.cos(angle) * radius);
    var ty = l.source.y + (Math.sin(angle) * radius);

    // End
    dx = l.target.x - d1.x;
    dy = l.target.y - d1.y;
    angle = Math.atan2(dy, dx);
    var ux = l.target.x - (Math.cos(angle) * radius);
    var uy = l.target.y - (Math.sin(angle) * radius);

    return "M" + tx + "," + ty
      + "S" + d1.x + "," + d1.y
      + " " + ux + "," + uy;
  }

  private displayGraph(countUniqueVertices: number, vertices: Vertex[], countUniqueEdges: number, edges: Edge[]) {
    try {
      this.clearGraph();

      // Set up nodes and links for the force simulation
      let nodes: ForceNode[] = vertices
        .map(v => <ForceNode>{ vertex: v });

      // Create map of nodes by ID
      let nodesById = new Map<string, ForceNode>();
      nodes.forEach(n => nodesById.set(n.vertex.id, n));

      // Create edges and set their source/target
      let links: ForceLink[] = [];
      edges.forEach(e => {
        var source = nodesById.get(e.inV);
        var target = nodesById.get(e.outV);

        if (source && target) {
          links.push({ edge: e, source, target });
        } else {
          console.error("Vertex not found");
        }
      });
      nodesById = null;

      let statsText: string = (nodes.length === countUniqueVertices && links.length === countUniqueEdges) ?
        `Displaying all ${nodes.length} vertices and ${links.length} edges` :
        `Displaying ${nodes.length} of ${countUniqueVertices} vertices and ${links.length} of ${countUniqueEdges} edges`;
      d3.select(htmlElements.stats).text(statsText);

      // Set up force simulation
      if (this._force) {
        this._force.stop();
      }

      this._force = d3.layout.force()
        .size([graphWidth, graphHeight])
        .nodes(nodes)
        .links(links);
      let force = this._force;

      force.gravity(1); // Makes the nodes gravitate toward the center
      force.friction(.5);

      force.linkDistance(linkDistance); // edge length
      force.linkStrength(linkStrength);
      force.charge(charge);

      let svg = d3.select(htmlElements.graphSection).select("svg")
        .attr("height", graphHeight);

      // Add a re-usable arrow
      svg.select('defs')
        .selectAll('marker')
        .data(['end'])
        .enter()
        .append('marker')
        .attr('id', 'triangle')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', markerDistanceFromVertex) // Shift arrow so that we can see it.
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .attr('markerUnits', 'userSpaceOnUse') // No auto-scaling with stroke width
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5');

      // Allow user to drag/zoom the entire SVG
      svg = svg
        .call(d3.behavior.zoom().on("zoom", function () {
          svg.attr("transform", "translate(" + d3.event.translate + ")" + " scale(" + d3.event.scale + ")")
        }))
        .append("g");

      // Links before nodes so that links don't get drawn on top of node labels, obscuring them
      let edge = svg.selectAll(".edge")
        .data(links)
        .enter()
        .append("path")
        .attr('class', 'edge')
        .attr('fill', 'none')
        .attr('marker-end', 'url(#triangle)');

      // Allow user to drag nodes. Set "dragging" class while dragging.
      let vertexDrag = force.drag().on("dragstart", function () {
        d3.select(this).classed("dragging", true);

        // Make sure a drag gesture doesn't also start a zoom action
        d3.event.sourceEvent.stopPropagation();
      })
        .on("dragend", function () { d3.select(this).classed("dragging", false); });

      // Labels
      let label = svg.selectAll(".label")
        .data(nodes)
        .enter().append("text")
        .attr("class", "label")
        .attr("x", "10px")
        .attr("y", "2px")
        .attr('font-size', 13)
        .text((d: ForceNode) => {
          let displayText = d.vertex.id;
          return displayText;
        })
        ;

      // Nodes last so that they're always and top to be able to be dragged
      let vertex = svg.selectAll(".vertex")
        .data(nodes)
        .enter().append("circle")
        .attr("class", "vertex")
        .attr("cx", (d: ForceNode) => d.x)
        .attr("cy", (d: ForceNode) => d.y)
        .call(vertexDrag)
        ;

      // On each tick of the simulation, update the positions of each vertex and edge
      force.on("tick", () => {
        vertex
          .transition().ease("linear").duration(animationStepMs)
          .attr("cx", (d: ForceNode) => d.x)
          .attr("cy", (d: ForceNode) => d.y)
          ;

        edge
          .transition().ease("linear").duration(animationStepMs)
          .attr("x1", (d: ForceLink) => d.source.x)
          .attr("y1", (d: ForceLink) => d.source.y)
          .attr("x2", (d: ForceLink) => d.target.x)
          .attr("y2", (d: ForceLink) => d.target.y)
          ;

        edge.attr("d", (d: ForceLink) => { return this.positionLink(d); });

        label
          .transition().ease("linear").duration(animationStepMs)
          .attr("class", "label")
          .attr("dx", (d: ForceNode) => d.x)
          .attr("dy", (d: ForceNode) => d.y)
          ;
      });

      force.start();
    } catch (err) {
      this.log(err);
    }
  }
}
