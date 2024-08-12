/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PostgreSQLManagementClient as PostgreSQLSingleManagementClient } from '@azure/arm-postgresql';
import { PostgreSQLManagementFlexibleServerClient } from '@azure/arm-postgresql-flexible';
import { AzExtClientContext } from '@microsoft/vscode-azext-azureutils';
import { createPostgreSQLClient, createPostgreSQLFlexibleClient } from '../../utils/azureClients';
import { PostgresServerType } from './models';

export type AbstractPostgresClient = PostgreSQLManagementFlexibleServerClient | PostgreSQLSingleManagementClient;

export async function createAbstractPostgresClient(
    serverType: PostgresServerType,
    context: AzExtClientContext,
): Promise<AbstractPostgresClient> {
    switch (serverType) {
        case PostgresServerType.Flexible:
            return await createPostgreSQLFlexibleClient(context);
        case PostgresServerType.Single:
            return await createPostgreSQLClient(context);
        default:
            throw new Error('Service not implemented.');
    }
}
