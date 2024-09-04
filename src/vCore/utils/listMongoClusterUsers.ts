import { type CosmosDBManagementClient } from '@azure/arm-cosmosdb';
import { createHttpHeaders } from '@azure/core-rest-pipeline';
import { nonNullProp, nonNullValue } from '@microsoft/vscode-azext-utils';
import { type MongoClusterUser } from './MongoClusterUser';

export async function listMongoClusterNonAdminUsers(
    client: CosmosDBManagementClient,
    props: { subscriptionId: string; resourceGroupName: string; mongoClusterNamer: string; clusterAdminUser: string }
): Promise<string[]> {
    const getUsersResponse = await client.sendRequest({
        method: 'GET',
        url: `https://management.azure.com/subscriptions/${props.subscriptionId}/resourceGroups/${props.resourceGroupName}/providers/Microsoft.DocumentDB/mongoClusters/${props.mongoClusterNamer}/users?api-version=2024-03-01-preview`,
        headers: createHttpHeaders({ 'Content-Type': 'application/json' }),
        timeout: 0,
        withCredentials: false,
        requestId: '',
    });

    if (getUsersResponse.status !== 200) {
        // we didn't get a valid response, it could be that the cluster doesn't have the user-management feature enabled
        // in this case we'll run the safe path and return an empty array

        // TODO: add telemetry to track this scenario

        return [];
    }

    const clusterUsers: MongoClusterUser[] = nonNullProp(
        JSON.parse(nonNullValue(getUsersResponse.bodyAsText, '[]') as string),
        'value',
    ) as MongoClusterUser[];

    const clusterUsersNamesArray: string[] = clusterUsers
        .filter((user) => user.name !== props.clusterAdminUser)
        .map((user) => user.name);

    return clusterUsersNamesArray;
}
