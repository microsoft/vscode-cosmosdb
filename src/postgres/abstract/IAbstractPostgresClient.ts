/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as msRest from "@azure/ms-rest-js";
import * as Models from './models';

export interface IAbstractPostgresClient {
    deleteServer(serverType: Models.PostgresServerType, resourceGroup: string, name: string): Promise<msRest.RestResponse>;
    listDatabases(serverType: Models.PostgresServerType, resourceGroup: string, name: string): Promise<Models.PostgresAbstractDatabaseList>;
    listServers(): Promise<Models.PostgresAbstractServerList>;
    createServer(serverType: Models.PostgresServerType, resourceGroup: string, name: string, options: Models.AbstractServerCreate): Promise<Models.PostgresAbstractServer>;
    checkNameAvailability(serverType: Models.PostgresServerType, name: string) : Promise<Models.AbstractNameAvailability>;
    createFirewallRule(serverType: Models.PostgresServerType, resourceGroup: string, name: string, ruleName: string, rule: Models.AbstractFirewallRule) : Promise<Models.AbstractFirewallRule>;
}
