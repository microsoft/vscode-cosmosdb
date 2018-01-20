/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IGremlinEndpoint } from "./gremlinEndpoints";

export interface GraphConfiguration {
  // e.g. https://graphaccount.documents.azure.com:443
  documentEndpoint: string;

  gremlinEndpoint?: IGremlinEndpoint;
  possibleGremlinEndpoints: IGremlinEndpoint[];

  key: string;
  databaseName: string;
  graphName: string;
}

export function areConfigsEqual(config1: GraphConfiguration, config2: GraphConfiguration): boolean {
  // Don't compare gremlin endpoints, documentEndpoint is enough to guarantee uniqueness
  return config1.documentEndpoint === config2.documentEndpoint &&
    config1.databaseName === config2.databaseName &&
    config1.graphName === config2.graphName;
}
