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
const defaultQuery = "g.V()";
const linkDistance = 400;
const linkStrength = 0.01; // Reduce rigidity of the links (if < 1, the full linkDistance is relaxed)
const charge = -3000;
const arrowDistanceFromVertex = 10;
const vertexRadius = 8; // from css
const paddingBetweenVertexAndEdge = 3;
const AutoColor = "auto";

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
  title: HTMLElement,
  resultsBackground: HTMLDivElement
};

type State = "empty" | "querying" | "error" | "json-results" | "graph-results";

window.onerror = (message) => {
  logToUI("ERROR: " + message);
};

function getErrorMessage(error: any) {
  return error.message || error.toString();
}

function logToUI(s: string) {
  console.log(s);
  // let v = htmlElements.debugLog.value;
  // v += "\r\n" + s;
  // htmlElements.debugLog.value = v;
}

interface ForceNode {
  vertex: GraphVertex;
  x: number;
  y: number;
}

interface ForceLink {
  edge: GraphEdge;
  source: ForceNode;
  target: ForceNode;
}

interface Point2D {
  x: number;
  y: number;
}

class SocketWrapper {
  constructor(private _socket: SocketIOClient.Socket) { }

  public onServerMessage(message: ServerMessage | "connect" | "disconnect", fn: Function): SocketIOClient.Emitter {
    return this._socket.on(message, (...args: any[]) => {
      try {
        fn(...args);
      } catch (err) {
        this.emitToHost('log', getErrorMessage(err));
        logToUI(err);
      }
    });
  }

  public emitToHost(message: ClientMessage, ...args: any[]): SocketIOClient.Socket {
    logToUI("Message to host: " + message + " " + args.join(", "));
    return this._socket.emit(message, ...args);
  }
}

export class GraphClient {
  private _socket: SocketWrapper;
  private _currentQueryId = 0;
  private _isGraphView: boolean;
  private _graphView: GraphView;

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
      jsonRadio: this.selectById("jsonRadio"),
      resultsBackground: this.selectById("resultsBackground")
    };

    this._graphView = new GraphView();

    htmlElements.queryInput.value = defaultQuery;

    this.setStateEmpty();

    this.log(`Listening on port ${port}`);
    this._socket = new SocketWrapper(io.connect(`http://localhost:${port}`));

    // setInterval(() => {
    //   this.log(`Client heartbeat on port ${port}: ${Date()}`);
    // }, 10000);

    this._socket.onServerMessage('connect', (): void => {
      this.log(`Client connected on port ${port}`);
      this._socket.emitToHost('getTitle');
    });

    this._socket.onServerMessage('disconnect', (): void => {
      this.log("disconnect");
    });

    this._socket.onServerMessage("setPageState", (pageState: PageState, viewSettings: GraphViewSettings) => {
      htmlElements.queryInput.value = pageState.query;

      if (pageState.isQueryRunning) {
        this._currentQueryId = pageState.runningQueryId;
        this.setStateQuerying();
        return;
      }

      if (!pageState.errorMessage) {
        this.showResults(pageState.results, viewSettings);
      } else {
        this.setStateError(pageState.errorMessage);
      }

      if (pageState.view === 'json') {
        this.selectJsonView();
      } else {
        this.selectGraphView();
      }
    });

    this._socket.onServerMessage("setTitle", (title: string): void => {
      this.log(`Received title: ${title}`);
      d3.select(htmlElements.title).text(title);
    });

    this._socket.onServerMessage("showResults", (queryId: number, results: GraphResults, viewSettings: GraphViewSettings): void => {
      this.log(`Received results for query ${queryId}`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring results, out of date");
      } else {
        this.showResults(results, viewSettings);
      }
    });

    this._socket.onServerMessage("showQueryError", (queryId: number, error: string): void => {
      this.log(`Received error for query ${queryId} - ${error}`);

      if (queryId !== this._currentQueryId) {
        this.log("  Ignoring error, out of date");
      } else {
        this.setStateError(error);
      }
    });
  }

  public getPageState() {
    this._socket.emitToHost('getPageState');
  }

  public copyParentStyleSheets() {
    // Copy style sheets from parent to pick up theme colors
    var head = document.getElementsByTagName("head")[0];
    var styleSheets = parent.document.getElementsByTagName("style");
    for (var i = 0; i < styleSheets.length; ++i) {
      head.insertBefore(styleSheets[i].cloneNode(true), head.firstChild);
    }
  }

  public query(gremlin: string) {
    this._currentQueryId += 1;
    this._socket.emitToHost("query", this._currentQueryId, gremlin);

    this.setStateQuerying();
  }

  public selectGraphView() {
    this._isGraphView = true;
    this.setView();
  }

  public selectJsonView() {
    this._isGraphView = false;
    this.setView();
  }

  public setQuery(query: string) {
    this._socket.emitToHost('setQuery', query);
  }

  // Tells the host which view is selected (Json/Graph/etc)
  private setView() {
    htmlElements.graphRadio.checked = this._isGraphView;
    htmlElements.jsonRadio.checked = !this._isGraphView;
    d3.select(htmlElements.graphSection).classed("active", !!this._isGraphView);
    d3.select(htmlElements.jsonSection).classed("active", !this._isGraphView);
    this._socket.emitToHost('setView', this._isGraphView ? 'graph' : 'json');
  }

  private log(s: string) {
    if (this._socket) {
      this._socket.emitToHost('log', s);
    }

    logToUI(s);
  }

  private setStateEmpty() {
    this._setState("empty");
  }

  private setStateQuerying() {
    this._setState("querying");
    this._graphView.clear();
  }

  private setStateResults(hasGraph: boolean) {
    this._setState(hasGraph ? "graph-results" : "json-results");
  }

  private setStateError(error: any) {
    htmlElements.queryError.value = getErrorMessage(error);
    this._setState("error");
    this._graphView.clear();
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

  private showResults(results: GraphResults, viewSettings: GraphViewSettings): void {
    // queryResults may contain any type of data, not just vertices or edges

    // Always show the full original results JSON
    htmlElements.jsonResults.value = JSON.stringify(results.fullResults, null, 2);

    if (!results.limitedVertices.length) {
      // No vertices to show, just show query JSON
      this.setStateResults(false);
      return;
    }

    this.setStateResults(true);
    this._graphView.display(results.countUniqueVertices, results.limitedVertices, results.countUniqueEdges, results.limitedEdges, viewSettings);
  }
}

class GraphView {
  private _force: any;
  private _defaultColorsPerLabel = new Map<string, string>();
  private _colorGenerator: (i: number) => string = d3.scale.category20();

  public display(countUniqueVertices: number, vertices: GraphVertex[], countUniqueEdges: number, edges: GraphEdge[], viewSettings: GraphViewSettings) {
    this.clear();
    this.generateDefaultColors(vertices);

    // Set up nodes and links for the force simulation
    let nodes: ForceNode[] = vertices
      .map(v => <ForceNode>{ vertex: v });

    // Create map of nodes by ID
    let nodesById = new Map<string, ForceNode>();
    nodes.forEach(n => nodesById.set(n.vertex.id, n));

    // Create edges and set their source/target
    let links: ForceLink[] = [];
    edges.forEach(e => {
      var source = nodesById.get(e.outV);
      var target = nodesById.get(e.inV);

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
      .size([htmlElements.resultsBackground.clientWidth, htmlElements.resultsBackground.clientHeight])
      .nodes(nodes)
      .links(links);
    let force = this._force;

    force.gravity(1); // Makes the nodes gravitate toward the center
    force.friction(.5);

    force.linkDistance(linkDistance); // edge length
    force.linkStrength(linkStrength);
    force.charge(charge);

    let svg = d3.select(htmlElements.graphSection).select("svg");

    // Add a re-usable arrow
    svg.select('defs')
      .selectAll('marker')
      .data(['end'])
      .enter()
      .append('marker')
      .attr('id', 'triangle')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', arrowDistanceFromVertex) // Shift arrow so that we can see it.
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
      .text((d: ForceNode) => this.getVertexDisplayText(d.vertex, viewSettings))
      ;

    // Nodes last so that they're always and top to be able to be dragged
    let vertex = svg.selectAll(".vertex")
      .data(nodes)
      .enter().append("circle")
      .attr("class", "vertex")
      .attr("cx", (d: ForceNode) => d.x)
      .attr("cy", (d: ForceNode) => d.y)
      .style("fill", (d: ForceNode) => this.getVertexColor(d.vertex, viewSettings))
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
  }

  public clear(): void {
    d3.select(htmlElements.graphSection).select("svg").selectAll(".vertex, .edge, .label").remove();
  }

  private generateDefaultColors(vertices: GraphVertex[]): void {
    // Keep previous entries, changing colors between queries would be confusing

    for (let i = 0; i < vertices.length; ++i) {
      let label = vertices[i].label;
      if (!this._defaultColorsPerLabel.get(label)) {
        let colorIndex = this._defaultColorsPerLabel.size;
        let newColor = this._colorGenerator(colorIndex);
        this._defaultColorsPerLabel.set(label, newColor);
      }
    }
  }

  private static calculateClosestPIOver2(angle: number): number {
    const CURVATURE_FACTOR = 40;
    const result = (Math.atan(CURVATURE_FACTOR * (angle - (Math.PI / 4))) / 2) + (Math.PI / 4);
    return result;
  }

  private static calculateControlPoint(start: Point2D, end: Point2D): Point2D {
    const alpha = Math.atan2(end.y - start.y, end.x - start.x);
    const n = Math.floor(alpha / (Math.PI / 2));
    const reducedAlpha = alpha - (n * Math.PI / 2);
    const reducedBeta = GraphView.calculateClosestPIOver2(reducedAlpha);
    const beta = reducedBeta + (n * Math.PI / 2);

    const length = Math.sqrt((end.y - start.y) * (end.y - start.y) + (end.x - start.x) * (end.x - start.x)) / 2;
    const result = {
      x: start.x + Math.cos(beta) * length,
      y: start.y + Math.sin(beta) * length
    };

    return result;
  }

  private positionLink(l: any) {
    const d1 = GraphView.calculateControlPoint(l.source, l.target);

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

  private findVertexPropertySetting(v: GraphVertex, viewSettings: GraphViewSettings, settingProperty: keyof VertexSettingsGroup): any | undefined {
    let label = v.label;

    for (let i = 0; i < viewSettings.length; ++i) {
      let graphSettingsGroup = viewSettings[i];
      let vertextSettingsGroups: VertexSettingsGroup[] = graphSettingsGroup.vertexSettings || [];

      // Check groups which specify a label filter first
      for (let i = 0; i < vertextSettingsGroups.length; ++i) {
        let group = vertextSettingsGroups[i];
        if (group.appliesToLabel && group.appliesToLabel === label) {
          // This settings group is applicable to this vertex
          let value = group[settingProperty];
          if (typeof value !== "undefined" && value !== null) {
            return value;
          }
        }
      }

      // Check for a default group with no appliesToLabel
      let defaultGroup: VertexSettingsGroup = vertextSettingsGroups.find(group => !group.appliesToLabel);
      if (defaultGroup) {
        let value = defaultGroup[settingProperty];
        if (typeof value !== "undefined" && value !== null) {
          return value;
        }
      }
    }
  }

  private getVertexColor(v: GraphVertex, viewSettings: GraphViewSettings): string {
    let color = this.findVertexPropertySetting(v, viewSettings, "color");
    if (color && color != AutoColor) {
      return color;
    }

    // Default is to use "auto" behavior and choose color based on label
    return this._defaultColorsPerLabel.get(v.label);
  }

  private getVertexDisplayText(v: GraphVertex, viewSettings: GraphViewSettings): string {
    let text: string;
    let propertyCandidates = this.findVertexPropertySetting(v, viewSettings, "displayProperty") || [];
    // Find the first specified property that exists and has a non-empty value
    for (let i = 0; i < propertyCandidates.length; ++i) {
      let candidate = propertyCandidates[i];
      if (candidate === "id") {
        text = v.id;
      } else if (candidate === "label" && v.label) {
        text = v.label;
      } else {
        if (v.properties && candidate in v.properties) {
          let property = v.properties[candidate][0];
          if (property && property.value) {
            text = property.value;
            break;
          }
        }
      }
    }

    // Otherwise use "id"
    text = text || v.id;

    let showLabel = this.findVertexPropertySetting(v, viewSettings, "showLabel");
    showLabel = typeof showLabel === "undefined" ? true : showLabel; // Default to true if not specified
    if (showLabel && v.label) {
      text += ` (${v.label})`;
    }

    return text;
  }
}
