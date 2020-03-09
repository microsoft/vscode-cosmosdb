/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { DatabaseAccount, DatabaseAccountListKeysResult, DatabaseAccountsListResult } from 'azure-arm-cosmosdb/lib/models';
import { PostgreSQLManagementClient } from 'azure-arm-postgresql';
import { DatabaseListResult, ServerListResult } from 'azure-arm-postgresql/lib/models';
import { Server } from 'azure-arm-postgresql/lib/models';
import * as vscode from 'vscode';
import { AzExtTreeItem, AzureTreeItem, AzureWizard, AzureWizardPromptStep, createAzureClient, ICreateChildImplContext, ILocationWizardContext, LocationListStep, ResourceGroupListStep, SubscriptionTreeItemBase } from 'vscode-azureextensionui';
import { DocDBAccountTreeItem } from "../docdb/tree/DocDBAccountTreeItem";
import { Experience } from '../experience';
import { getExperienceLabel_cosmosdb, tryGetExperience_cosmosdb } from '../experienceCosmosDB';
import { getExperienceLabel_postgres, tryGetExperience_postgres } from '../experiencePostgres';
import { TryGetGremlinEndpointFromAzure } from '../graph/gremlinEndpoints';
import { GraphAccountTreeItem } from "../graph/tree/GraphAccountTreeItem";
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { PostgreSQLAccountTreeItem } from '../postgres/tree/PostgreSQLAccountTreeItem';
import { TableAccountTreeItem } from "../table/tree/TableAccountTreeItem";
import { azureUtils } from '../utils/azureUtils';
import { CosmosDBAccountApiStep } from './CosmosDBAccountWizard/CosmosDBAccountApiStep';
import { CosmosDBAccountCreateStep } from './CosmosDBAccountWizard/CosmosDBAccountCreateStep';
import { CosmosDBAccountNameStep } from './CosmosDBAccountWizard/CosmosDBAccountNameStep';
import { ICosmosDBWizardContext } from './CosmosDBAccountWizard/ICosmosDBWizardContext';

export class SubscriptionTreeItem extends SubscriptionTreeItemBase {
    public childTypeLabel: string = 'Account';

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {

        let treeItemPostgres: AzExtTreeItem[];
        let treeItem: AzExtTreeItem[];

        //Postgres
        const clientPostgres: PostgreSQLManagementClient = createAzureClient(this.root, PostgreSQLManagementClient);
        const accountsPostgres: ServerListResult = await clientPostgres.servers.list();
        const databasesPostgres: DatabaseListResult = await clientPostgres.databases.listByServer("myResourceGroup", accountsPostgres[0].name);
        treeItemPostgres = await this.createTreeItemsWithErrorHandling(
            accountsPostgres,
            'invalidPostgreSQLAccount',
            async (server: Server) => await this.initChild(clientPostgres, null, server, databasesPostgres),
            (server: Server) => server.name
        );

        const client: CosmosDBManagementClient = createAzureClient(this.root, CosmosDBManagementClient);
        const accounts: DatabaseAccountsListResult = await client.databaseAccounts.list();
        treeItem = await this.createTreeItemsWithErrorHandling(
            accounts,
            'invalidCosmosDBAccount',
            async (db: DatabaseAccount) => await this.initChild(client, db),
            (db: DatabaseAccount) => db.name
        );

        treeItem.push(treeItemPostgres.pop());
        return treeItem;
    }

    public async createChildImpl(context: ICreateChildImplContext): Promise<AzureTreeItem> {
        const client: CosmosDBManagementClient = createAzureClient(this.root, CosmosDBManagementClient);
        const wizardContext: ICosmosDBWizardContext = Object.assign(context, this.root);

        const promptSteps: AzureWizardPromptStep<ILocationWizardContext>[] = [
            new CosmosDBAccountNameStep(),
            new CosmosDBAccountApiStep(),
            new ResourceGroupListStep()
        ];
        LocationListStep.addStep(wizardContext, promptSteps);

        const wizard = new AzureWizard(wizardContext, {
            promptSteps,
            executeSteps: [
                new CosmosDBAccountCreateStep()
            ],
            title: 'Create new Cosmos DB account'
        });

        await wizard.prompt();

        wizardContext.telemetry.properties.defaultExperience = wizardContext.defaultExperience.api;

        context.showCreatingTreeItem(wizardContext.accountName);
        await wizard.execute();
        // don't wait
        vscode.window.showInformationMessage(`Successfully created account "${wizardContext.accountName}".`);
        return await this.initChild(client, wizardContext.databaseAccount);
    }

    public isAncestorOfImpl(contextValue: string | RegExp): boolean {
        return typeof contextValue !== 'string' || !/attached/i.test(contextValue);
    }

    private async initChild(client: CosmosDBManagementClient | PostgreSQLManagementClient, databaseAccount?: DatabaseAccount, serverAccount?: Server, databasesPostgres?: DatabaseListResult): Promise<AzureTreeItem> {
        let experience: Experience | undefined;
        let resourceGroup: string;
        let accountKindLabel;
        let label: string;
        const isEmulator: boolean = false;

        if (client instanceof CosmosDBManagementClient && databaseAccount) {
            experience = tryGetExperience_cosmosdb(databaseAccount);
            resourceGroup = azureUtils.getResourceGroupFromId(databaseAccount.id);
            accountKindLabel = getExperienceLabel_cosmosdb(databaseAccount);
            const dbName: string = databaseAccount.name;
            label = dbName + (accountKindLabel ? ` (${accountKindLabel})` : ``);
            if (experience && experience.api === "MongoDB") {
                const result = await client.databaseAccounts.listConnectionStrings(resourceGroup, databaseAccount.name);
                // Use the default connection string
                return new MongoAccountTreeItem(this, databaseAccount.id, label, result.connectionStrings[0].connectionString, isEmulator, databaseAccount);
            } else {
                const keyResult: DatabaseAccountListKeysResult = await client.databaseAccounts.listKeys(resourceGroup, databaseAccount.name);
                switch (experience && experience.api) {
                    case "Table":
                        return new TableAccountTreeItem(this, databaseAccount.id, label, databaseAccount.documentEndpoint, keyResult.primaryMasterKey, isEmulator, databaseAccount);
                    case "Graph": {
                        const gremlinEndpoint = await TryGetGremlinEndpointFromAzure(client, resourceGroup, databaseAccount.name);
                        return new GraphAccountTreeItem(this, databaseAccount.id, label, databaseAccount.documentEndpoint, gremlinEndpoint, keyResult.primaryMasterKey, isEmulator, databaseAccount);
                    }
                    case "Core":
                    default:
                        // Default to DocumentDB, the base type for all Cosmos DB Accounts
                        return new DocDBAccountTreeItem(this, databaseAccount.id, label, databaseAccount.documentEndpoint, keyResult.primaryMasterKey, isEmulator, databaseAccount);

                }
            }
        } else {
            experience = tryGetExperience_postgres(serverAccount);
            resourceGroup = azureUtils.getResourceGroupFromId(serverAccount.id);
            accountKindLabel = getExperienceLabel_postgres(serverAccount);
            const databaseName: string = serverAccount.name;
            label = databaseName + (accountKindLabel ? ` (${accountKindLabel})` : ``);
            return new PostgreSQLAccountTreeItem(this, serverAccount.id, label, isEmulator, serverAccount, databasesPostgres);
        }
    }
}
