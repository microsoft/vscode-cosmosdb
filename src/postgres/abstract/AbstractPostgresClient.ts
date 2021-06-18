/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PostgreSQLManagementClient } from "@azure/arm-postgresql";
import { PostgreSQLFlexibleManagementClient } from "@azure/arm-postgresql-flexible";
import * as msRest from "@azure/ms-rest-js";
import { IAbstractPostgresClient } from "./IAbstractPostgresClient";
import { asAbstractDatabase, asFlexibleParameters, asSingleParameters, flexibleAsAbstractServer, singleAsAbstractServer } from "./maps";
import { AbstractServerCreate, PostgresAbstractDatabaseList, PostgresAbstractServer, PostgresAbstractServerList, PostgresServerType } from "./models";

export class AbstractPostgresClient implements IAbstractPostgresClient  {
    private postgresFlexibleClient: PostgreSQLFlexibleManagementClient;
    private postgresSingleClient: PostgreSQLManagementClient;

    constructor(credentials: msRest.ServiceClientCredentials, subscriptionId: string) {
        this.postgresFlexibleClient = new PostgreSQLFlexibleManagementClient(credentials, subscriptionId);
        this.postgresSingleClient = new PostgreSQLManagementClient(credentials, subscriptionId);
    }

    async createServer(serverType: PostgresServerType, resourceGroup: string, name: string, parameters: AbstractServerCreate): Promise<PostgresAbstractServer> {
        switch (serverType){
            case PostgresServerType.Flexible:
                return flexibleAsAbstractServer(await this.postgresFlexibleClient.servers.create(resourceGroup, name, asFlexibleParameters(parameters)));
            case PostgresServerType.Single:
                return singleAsAbstractServer(await this.postgresSingleClient.servers.create(resourceGroup, name, asSingleParameters(parameters)));
            default:
                throw new Error("Service not implemented.");
        }
    }

    async listServers(): Promise<PostgresAbstractServerList> {
        const flexServers = (await this.postgresFlexibleClient.servers.list()).map(flexibleAsAbstractServer);
        const singleServers = (await this.postgresSingleClient.servers.list()).map(singleAsAbstractServer);
        return Array<PostgresAbstractServer>().concat(flexServers, singleServers);
    }

    async listDatabases(serverType: PostgresServerType, resourceGroup: string, name: string): Promise<PostgresAbstractDatabaseList> {
        switch (serverType){
            case PostgresServerType.Flexible:
                return (await this.postgresFlexibleClient.databases.listByServer(resourceGroup, name)).map(asAbstractDatabase);
            case PostgresServerType.Single:
                return (await this.postgresSingleClient.databases.listByServer(resourceGroup, name)).map(asAbstractDatabase);
            default:
                throw new Error("Service not implemented.");
        }
    }

    async deleteServer(serverType: PostgresServerType, resourceGroup: string, name: string): Promise<msRest.RestResponse> {
        switch (serverType){
            case PostgresServerType.Flexible:
                return this.postgresFlexibleClient.servers.deleteMethod(resourceGroup, name);
            case PostgresServerType.Single:
                return this.postgresSingleClient.servers.deleteMethod(resourceGroup, name);
            default:
                throw new Error("Service not implemented.");
        }
    }
}
