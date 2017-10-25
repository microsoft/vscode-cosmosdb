/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface GraphConfiguration {
  endpoint: string;
  endpointPort: number;
  key: string;
  databaseName: string;
  graphName: string;

}

export function areConfigsEquals(config1: GraphConfiguration, config2: GraphConfiguration): boolean {
  return config1.endpoint === config2.endpoint &&
    config1.endpointPort === config2.endpointPort &&
    config1.databaseName === config2.databaseName &&
    config1.graphName === config2.graphName;
}
