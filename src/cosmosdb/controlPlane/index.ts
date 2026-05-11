/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type AccountInfo } from '../../tree/cosmosdb/AccountInfo';
import { type NoSqlQueryConnection } from '../NoSqlQueryConnection';
import { ArmCosmosDBControlPlane } from './ArmCosmosDBControlPlane';
import { type CosmosDBControlPlane } from './CosmosDBControlPlane';
import { DataPlaneCosmosDBControlPlane } from './DataPlaneCosmosDBControlPlane';

export { type CosmosDBControlPlane, type ThroughputResource } from './CosmosDBControlPlane';

/**
 * Returns the appropriate control-plane implementation for an account.
 *
 * - Azure-signed-in accounts (with a known subscription and resource group)
 *   use the ARM management plane. This is required for accounts configured
 *   with native data-plane RBAC, where data-plane control operations are
 *   rejected by the service (see issue #2990).
 * - The local emulator and workspace-attached connection-string accounts use
 *   the data-plane `CosmosClient` because ARM is not reachable for them.
 *
 * TODO: workspace-attached accounts that point at a real Azure Cosmos DB
 * account configured with strict native data-plane RBAC will still fall into
 * the data-plane branch (no subscription/resource-group context is captured
 * from a connection string), so control-plane operations will be rejected by
 * the service. Resolving this requires either prompting the user to associate
 * the attached account with an Azure subscription or extending the
 * connection-string import flow to capture that context.
 */
export function getControlPlane(accountInfo: AccountInfo): CosmosDBControlPlane {
    if (!accountInfo.isEmulator && accountInfo.subscription && accountInfo.resourceGroup) {
        return new ArmCosmosDBControlPlane(accountInfo.subscription, accountInfo.resourceGroup, accountInfo.name);
    }
    return new DataPlaneCosmosDBControlPlane(accountInfo);
}

/**
 * Returns the appropriate control-plane implementation for a query-editor
 * connection. Mirrors {@link getControlPlane} but takes a
 * {@link NoSqlQueryConnection}, which carries an optional Azure subscription
 * and resource group when the connection originated from an Azure-signed-in
 * account.
 */
export function getControlPlaneForConnection(connection: NoSqlQueryConnection): CosmosDBControlPlane {
    if (!connection.isEmulator && connection.subscription && connection.resourceGroup && connection.accountName) {
        return new ArmCosmosDBControlPlane(connection.subscription, connection.resourceGroup, connection.accountName);
    }
    return new DataPlaneCosmosDBControlPlane(connection);
}
