/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PostgreSQLManagementClient } from "@azure/arm-postgresql";
import { PostgreSQLFlexibleManagementClient } from "@azure/arm-postgresql-flexible";
import * as msRest from "@azure/ms-rest-js";
import { IMinimumServiceClientOptions } from "vscode-azureextensionui";
import { asAbstractDatabase, asFlexibleParameters, asSingleParameters, flexibleAsAbstractServer, singleAsAbstractServer } from "./maps";
import * as Models from "./models";

export class AbstractPostgresClient {
    private postgresFlexibleClient: PostgreSQLFlexibleManagementClient;
    private postgresSingleClient: PostgreSQLManagementClient;

    constructor(credentials: msRest.ServiceClientCredentials, subscriptionId: string, options?: IMinimumServiceClientOptions) {
        this.postgresFlexibleClient = new PostgreSQLFlexibleManagementClient(credentials, subscriptionId, options);
        this.postgresSingleClient = new PostgreSQLManagementClient(credentials, subscriptionId, options);
    }

    async checkNameAvailability(serverType: Models.PostgresServerType, name: string) : Promise<Models.AbstractNameAvailability> {
        switch (serverType){
            case Models.PostgresServerType.Flexible:
                return this.postgresFlexibleClient.checkNameAvailability.execute({name: name, type: "Microsoft.DBforPostgreSQL"});
            case Models.PostgresServerType.Single:
                return this.postgresSingleClient.checkNameAvailability.execute({name: name, type: "Microsoft.DBforPostgreSQL"});
            default:
                throw new Error("Service not implemented.");
        }
    }

    async createOrUpdateFirewallRule(serverType: Models.PostgresServerType, resourceGroup: string, name: string, ruleName: string, rule: Models.AbstractFirewallRule): Promise<Models.AbstractFirewallRule> {
        switch (serverType){
            case Models.PostgresServerType.Flexible:
                return this.postgresFlexibleClient.firewallRules.createOrUpdate(resourceGroup, name, ruleName, rule);
            case Models.PostgresServerType.Single:
                return this.postgresSingleClient.firewallRules.createOrUpdate(resourceGroup, name, ruleName, rule);
            default:
                throw new Error("Service not implemented.");
        }
    }

    async createServer(serverType: Models.PostgresServerType, resourceGroup: string, name: string, parameters: Models.AbstractServerCreate): Promise<Models.PostgresAbstractServer> {
        switch (serverType){
            case Models.PostgresServerType.Flexible:
                return flexibleAsAbstractServer(await this.postgresFlexibleClient.servers.create(resourceGroup, name, asFlexibleParameters(parameters)));
            case Models.PostgresServerType.Single:
                return singleAsAbstractServer(await this.postgresSingleClient.servers.create(resourceGroup, name, asSingleParameters(parameters)));
            default:
                throw new Error("Service not implemented.");
        }
    }

    async deleteServer(serverType: Models.PostgresServerType, resourceGroup: string, name: string): Promise<msRest.RestResponse> {
        switch (serverType){
            case Models.PostgresServerType.Flexible:
                return this.postgresFlexibleClient.servers.deleteMethod(resourceGroup, name);
            case Models.PostgresServerType.Single:
                return this.postgresSingleClient.servers.deleteMethod(resourceGroup, name);
            default:
                throw new Error("Service not implemented.");
        }
    }

    async listAllServers(): Promise<Models.PostgresAbstractServerList> {
        const flexServers = (await this.postgresFlexibleClient.servers.list()).map(flexibleAsAbstractServer);
        const singleServers = (await this.postgresSingleClient.servers.list()).map(singleAsAbstractServer);
        return Array<Models.PostgresAbstractServer>().concat(flexServers, singleServers);
    }

    async listDatabases(serverType: Models.PostgresServerType, resourceGroup: string, name: string): Promise<Models.PostgresAbstractDatabaseList> {
        switch (serverType){
            case Models.PostgresServerType.Flexible:
                return (await this.postgresFlexibleClient.databases.listByServer(resourceGroup, name)).map(asAbstractDatabase);
            case Models.PostgresServerType.Single:
                return (await this.postgresSingleClient.databases.listByServer(resourceGroup, name)).map(asAbstractDatabase);
            default:
                throw new Error("Service not implemented.");
        }
    }
}
