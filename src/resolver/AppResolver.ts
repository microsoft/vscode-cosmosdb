/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import {
    callWithTelemetryAndErrorHandling,
    nonNullProp,
    nonNullValue,
    type AzExtParentTreeItem,
    type IActionContext,
    type ISubscriptionContext,
} from '@microsoft/vscode-azext-utils';
import { type AppResource, type AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import { ext } from '../extensionVariables';
import { PostgresServerType, type PostgresAbstractServer } from '../postgres/abstract/models';
import { createPostgresConnectionString, parsePostgresConnectionString } from '../postgres/postgresConnectionStrings';
import { PostgresServerTreeItem } from '../postgres/tree/PostgresServerTreeItem';
import { createPostgreSQLClient, createPostgreSQLFlexibleClient } from '../utils/azureClients';
import { type ResolvedDatabaseAccountResource } from './ResolvedDatabaseAccountResource';
import { ResolvedPostgresServerResource } from './ResolvedPostgresServerResource';

const resourceTypes = [
    'microsoft.documentdb/databaseaccounts',
    'microsoft.dbforpostgresql/servers',
    'microsoft.dbforpostgresql/flexibleservers',
    'Microsoft.DBforPostgreSQL/serverGroupsv2',
];

export class DatabaseResolver implements AppResourceResolver {
    public async resolveResource(
        subContext: ISubscriptionContext,
        resource: AppResource,
    ): Promise<ResolvedDatabaseAccountResource | null | undefined> {
        return await callWithTelemetryAndErrorHandling('resolveResource', async (context: IActionContext) => {
            const subNode: AzExtParentTreeItem | undefined = await ext.rgApi.appResourceTree.findTreeItem(
                `/subscriptions/${subContext.subscriptionId}`,
                context,
            );
            try {
                const resourceGroupName = getResourceGroupFromId(nonNullProp(resource, 'id'));
                const name = nonNullProp(resource, 'name');
                context.valuesToMask.push(resource.id);
                context.valuesToMask.push(resource.name);

                switch (resource.type.toLowerCase()) {
                    case resourceTypes[1]:
                    case resourceTypes[2]: {
                        const postgresClient =
                            resource.type.toLowerCase() === resourceTypes[1]
                                ? await createPostgreSQLClient({ ...context, ...subContext })
                                : await createPostgreSQLFlexibleClient({ ...context, ...subContext });

                        const postgresServer: PostgresAbstractServer = await postgresClient.servers.get(
                            resourceGroupName,
                            name,
                        );
                        const fullyQualifiedDomainName = nonNullProp(postgresServer, 'fullyQualifiedDomainName');
                        const connectionString = createPostgresConnectionString(fullyQualifiedDomainName);
                        const parsedCS = parsePostgresConnectionString(connectionString);
                        const parent = nonNullValue(subNode);

                        postgresServer.serverType ??=
                            resource.type.toLowerCase() === resourceTypes[1]
                                ? PostgresServerType.Single
                                : PostgresServerType.Flexible;

                        return new ResolvedPostgresServerResource(
                            new PostgresServerTreeItem(parent, parsedCS, postgresServer),
                            resource,
                        );
                    }
                    default:
                        return null;
                }
            } catch (e) {
                console.error({ ...context, ...subContext });
                throw e;
            }
        });
    }

    public matchesResource(resource: AppResource): boolean {
        return resourceTypes.includes(resource.type.toLowerCase());
    }
}
