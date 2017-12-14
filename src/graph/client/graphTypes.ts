/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * These types are shared between server and client code
 */

interface GraphResults {
  fullResults: any[];
  countUniqueVertices: number;
  countUniqueEdges: number;

  // Limited by max
  limitedVertices: GraphVertex[];
  limitedEdges: GraphEdge[];
}

interface GraphEdge {
  id: string;
  type: "edge";
  outV: string;  // Edge source ID
  inV: string;   // Edge target ID
}

interface GraphVertex {
  id: string;
  type: "vertex";
  label: string;
  properties: {
    [key: string]: [
      {
        id: string;
        value: string;
      }
    ]
  }
}

interface VertexSettingsGroup {
  labels?: string[];
  displayProperty?: string[];
  color?: string;
  showLabel?: boolean;
}

interface GraphSettingsGroup {
  vertices?: VertexSettingsGroup[];
}

interface ViewSettings {
  // Currently on default group is supported
  default: GraphSettingsGroup;
}

interface PageState {
  query: string | undefined;
  results: GraphResults | undefined;
  errorMessage: string | undefined;
  view: 'graph' | 'json';
  isQueryRunning: boolean;
  runningQueryId: number;
}

// Messages that are sent from the server to the client
type ServerMessage = "setTitle" | "showResults" | "showQueryError" | "setPageState";

// Messages that are sent from the client to the server
type ClientMessage = "getPageState" | "getTitle" | "getPageState" | "query" | "setQuery" | "setView" | "log";
