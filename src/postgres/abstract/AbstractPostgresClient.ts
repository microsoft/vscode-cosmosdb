/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PostgreSQLManagementClient } from "@azure/arm-postgresql";
import { PostgreSQLFlexibleManagementClient } from "@azure/arm-postgresql-flexible";
import { createAzureClient, ISubscriptionContext } from "vscode-azureextensionui";
import { PostgresServerType } from "./models";

export type AbstractPostgresClient = PostgreSQLFlexibleManagementClient | PostgreSQLManagementClient;

export function createAbstractPostgresClient(serverType: PostgresServerType, clientInfo: ISubscriptionContext): AbstractPostgresClient {
    switch (serverType) {
        case PostgresServerType.Flexible:
            return createAzureClient(clientInfo, PostgreSQLFlexibleManagementClient);
        case PostgresServerType.Single:
            return createAzureClient(clientInfo, PostgreSQLManagementClient);
        default:
            throw new Error("Service not implemented.");
    }
}
