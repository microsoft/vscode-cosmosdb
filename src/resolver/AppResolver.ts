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
    type AzExtTreeItem,
    type IActionContext,
    type ISubscriptionContext,
} from '@microsoft/vscode-azext-utils';
import { type AppResource, type AppResourceResolver } from '@microsoft/vscode-azext-utils/hostapi';
import { API, tryGetExperience } from '../AzureDBExperiences';
import { type DocDBAccountTreeItem } from '../docdb/tree/DocDBAccountTreeItem';
import { ext } from '../extensionVariables';
import { type MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { type PostgresAbstractServer } from '../postgres/abstract/models';
import { type PostgresServerTreeItem } from '../postgres/tree/PostgresServerTreeItem';
import { SubscriptionTreeItem } from '../tree/SubscriptionTreeItem';
import { createCosmosDBClient, createPostgreSQLClient, createPostgreSQLFlexibleClient } from '../utils/azureClients';
import { type ResolvedDatabaseAccountResource } from './ResolvedDatabaseAccountResource';
import { ResolvedDocDBAccountResource } from './ResolvedDocDBAccountResource';
import { ResolvedMongoAccountResource } from './ResolvedMongoAccountResource';
import { ResolvedPostgresServerResource } from './ResolvedPostgresServerResource';

const resourceTypes = [
    'microsoft.documentdb/databaseaccounts',
    'microsoft.dbforpostgresql/servers',
    'microsoft.dbforpostgresql/flexibleservers',
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
                let postgresServer: PostgresAbstractServer;
                let dbChild: AzExtTreeItem;

                switch (resource.type.toLowerCase()) {
                    case resourceTypes[0]: {
                        const client = await createCosmosDBClient({ ...context, ...subContext });
                        const databaseAccount = await client.databaseAccounts.get(resourceGroupName, name);
                        dbChild = await SubscriptionTreeItem.initCosmosDBChild(
                            client,
                            databaseAccount,
                            nonNullValue(subNode),
                        );
                        const experience = tryGetExperience(databaseAccount);

                        return experience?.api === API.MongoDB
                            ? new ResolvedMongoAccountResource(dbChild as MongoAccountTreeItem, resource)
                            : new ResolvedDocDBAccountResource(dbChild as DocDBAccountTreeItem, resource);
                    }
                    case resourceTypes[1]:
                    case resourceTypes[2]: {
                        const postgresClient =
                            resource.type.toLowerCase() === resourceTypes[1]
                                ? await createPostgreSQLClient({ ...context, ...subContext })
                                : await createPostgreSQLFlexibleClient({ ...context, ...subContext });

                        postgresServer = await postgresClient.servers.get(resourceGroupName, name);
                        dbChild = await SubscriptionTreeItem.initPostgresChild(postgresServer, nonNullValue(subNode));

                        return new ResolvedPostgresServerResource(dbChild as PostgresServerTreeItem, resource);
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
