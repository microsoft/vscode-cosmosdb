/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { azureUtils } from '../utils/azureUtils';
import { IAzureTreeItem, IAzureNode, IChildProvider } from 'vscode-azureextensionui';
import { TableAccountTreeItem } from "../table/tree/TableAccountTreeItem";
import { GraphAccountTreeItem } from "../graph/tree/GraphAccountTreeItem";
import { DocDBAccountTreeItem } from "../docdb/tree/DocDBAccountTreeItem";
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import CosmosDBManagementClient = require("azure-arm-cosmosdb");
import { DatabaseAccountsListResult, DatabaseAccount, DatabaseAccountListKeysResult } from 'azure-arm-cosmosdb/lib/models';
import { createCosmosDBAccount } from '../commands';
import { Experience } from '../constants';
import { TryGetGremlinEndpointFromAzure } from '../graph/gremlinEndpoints';

export class CosmosDBAccountProvider implements IChildProvider {
    public childTypeLabel: string = 'Account';

    public hasMoreChildren(): boolean {
        return false;
    }

    public async loadMoreChildren(node: IAzureNode): Promise<IAzureTreeItem[]> {
        const client = new CosmosDBManagementClient(node.credentials, node.subscription.subscriptionId);
        const accounts: DatabaseAccountsListResult = await client.databaseAccounts.list();

        return await Promise.all(accounts.map(async (databaseAccount: DatabaseAccount) => {
            return await this.initChild(client, databaseAccount);
        }));
    }

    public async createChild(node: IAzureNode, showCreatingNode: (label: string) => void): Promise<IAzureTreeItem> {
        const client = new CosmosDBManagementClient(node.credentials, node.subscription.subscriptionId);
        const databaseAccount = await createCosmosDBAccount(node, showCreatingNode);
        return await this.initChild(client, databaseAccount);
    }

    private async initChild(client: CosmosDBManagementClient, databaseAccount: DatabaseAccount): Promise<IAzureTreeItem> {
        const defaultExperience = <Experience>databaseAccount.tags.defaultExperience;
        const resourceGroup: string = azureUtils.getResourceGroupFromId(databaseAccount.id);
        const label: string = `${databaseAccount.name} (${resourceGroup})`;
        if (defaultExperience === "MongoDB") {
            const result = await client.databaseAccounts.listConnectionStrings(resourceGroup, databaseAccount.name);
            // Use the default connection string
            return new MongoAccountTreeItem(databaseAccount.id, label, result.connectionStrings[0].connectionString);
        } else {
            const keyResult: DatabaseAccountListKeysResult = await client.databaseAccounts.listKeys(resourceGroup, databaseAccount.name);
            switch (defaultExperience) {
                case "Table":
                    return new TableAccountTreeItem(databaseAccount.id, label, databaseAccount.documentEndpoint, keyResult.primaryMasterKey);
                case "Graph": {
                    const gremlinEndpoint = await TryGetGremlinEndpointFromAzure(client, databaseAccount.documentEndpoint, resourceGroup, databaseAccount.name);
                    return new GraphAccountTreeItem(databaseAccount.id, label, databaseAccount.documentEndpoint, gremlinEndpoint, keyResult.primaryMasterKey);
                }
                case "DocumentDB":
                default:
                    // Default to DocumentDB, the base type for all Cosmos DB Accounts
                    return new DocDBAccountTreeItem(databaseAccount.id, label, databaseAccount.documentEndpoint, keyResult.primaryMasterKey);
            }
        }
    }
}
