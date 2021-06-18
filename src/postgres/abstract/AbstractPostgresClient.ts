/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PostgreSQLManagementClient } from "@azure/arm-postgresql";
import { PostgreSQLFlexibleManagementClient } from "@azure/arm-postgresql-flexible";
import * as msRest from "@azure/ms-rest-js";
import { IAbstractPostgresClient } from "./IAbstractPostgresClient";
import { asAbstractServer } from "./maps";
import { PostgresAbstractServer, PostgresAbstractServerList } from "./models";

export class AbstractPostgresClient implements IAbstractPostgresClient  {
    private postgresFlexibleClient: PostgreSQLFlexibleManagementClient;
    private postgresSingleClient: PostgreSQLManagementClient;

    constructor(credentials: msRest.ServiceClientCredentials, subscriptionId: string) {
        this.postgresFlexibleClient = new PostgreSQLFlexibleManagementClient(credentials, subscriptionId);
        this.postgresSingleClient = new PostgreSQLManagementClient(credentials, subscriptionId);
    }

    async listServers(): Promise<PostgresAbstractServerList> {
        const flexServers = (await this.postgresFlexibleClient.servers.list()).map(asAbstractServer);
        const singleServers = (await this.postgresSingleClient.servers.list()).map(asAbstractServer);
        return Array<PostgresAbstractServer>().concat(flexServers, singleServers);
    }
}
