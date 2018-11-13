/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { DatabaseAccount, DatabaseAccountListKeysResult, DatabaseAccountsListResult } from 'azure-arm-cosmosdb/lib/models';
import * as vscode from 'vscode';
import { AzureTreeItem, AzureWizard, createAzureClient, createTreeItemsWithErrorHandling, IActionContext, LocationListStep, ResourceGroupListStep, SubscriptionTreeItem } from 'vscode-azureextensionui';
import { DocDBAccountTreeItem } from "../docdb/tree/DocDBAccountTreeItem";
import { API, getExperience } from '../experiences';
import { TryGetGremlinEndpointFromAzure } from '../graph/gremlinEndpoints';
import { GraphAccountTreeItem } from "../graph/tree/GraphAccountTreeItem";
import { MongoAccountTreeItem } from '../mongo/tree/MongoAccountTreeItem';
import { TableAccountTreeItem } from "../table/tree/TableAccountTreeItem";
import { azureUtils } from '../utils/azureUtils';
import { CosmosDBAccountApiStep } from './CosmosDBAccountWizard/CosmosDBAccountApiStep';
import { CosmosDBAccountCreateStep } from './CosmosDBAccountWizard/CosmosDBAccountCreateStep';
import { CosmosDBAccountNameStep } from './CosmosDBAccountWizard/CosmosDBAccountNameStep';
import { ICosmosDBWizardContext } from './CosmosDBAccountWizard/ICosmosDBWizardContext';

export class CosmosDBAccountProvider extends SubscriptionTreeItem {
    public childTypeLabel: string = 'Account';

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzureTreeItem[]> {
        const client: CosmosDBManagementClient = createAzureClient(this.root, CosmosDBManagementClient);
        const accounts: DatabaseAccountsListResult = await client.databaseAccounts.list();
        return await createTreeItemsWithErrorHandling(
            this,
            accounts,
            'invalidCosmosDBAccount',
            async (db: DatabaseAccount) => await this.initChild(client, db),
            (db: DatabaseAccount) => db.name
        );
    }

    public async createChildImpl(showCreatingTreeItem: (label: string) => void, actionContext?: IActionContext): Promise<AzureTreeItem> {
        const client: CosmosDBManagementClient = createAzureClient(this.root, CosmosDBManagementClient);
        const wizardContext: ICosmosDBWizardContext = Object.assign({}, this.root);

        const wizard = new AzureWizard(
            [
                new CosmosDBAccountNameStep(),
                new CosmosDBAccountApiStep(),
                new ResourceGroupListStep(),
                new LocationListStep()
            ],
            [
                new CosmosDBAccountCreateStep()
            ],
            wizardContext);

        // https://github.com/Microsoft/vscode-azuretools/issues/120
        actionContext = actionContext || <IActionContext>{ properties: {}, measurements: {} };

        await wizard.prompt(actionContext);

        actionContext.properties.defaultExperience = wizardContext.defaultExperience.api;

        await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (progress) => {
            showCreatingTreeItem(wizardContext.accountName);
            progress.report({ message: `Cosmos DB: Creating account '${wizardContext.accountName}'` });
            await wizard.execute(actionContext);
        });
        return await this.initChild(client, wizardContext.databaseAccount);
    }

    private async initChild(client: CosmosDBManagementClient, databaseAccount: DatabaseAccount): Promise<AzureTreeItem> {
        const defaultExperience = <API>(databaseAccount && databaseAccount.tags && databaseAccount.tags.defaultExperience);
        const resourceGroup: string = azureUtils.getResourceGroupFromId(databaseAccount.id);
        const accountKind = getExperience(defaultExperience).shortName;
        const label: string = databaseAccount.name + (accountKind ? ` (${accountKind})` : ``);
        const isEmulator: boolean = false;
        if (defaultExperience === "MongoDB") {
            const result = await client.databaseAccounts.listConnectionStrings(resourceGroup, databaseAccount.name);
            // Use the default connection string
            return new MongoAccountTreeItem(this, databaseAccount.id, label, result.connectionStrings[0].connectionString, isEmulator, databaseAccount);
        } else {
            const keyResult: DatabaseAccountListKeysResult = await client.databaseAccounts.listKeys(resourceGroup, databaseAccount.name);
            switch (defaultExperience) {
                case "Table":
                    return new TableAccountTreeItem(this, databaseAccount.id, label, databaseAccount.documentEndpoint, keyResult.primaryMasterKey, isEmulator, databaseAccount);
                case "Graph": {
                    const gremlinEndpoint = await TryGetGremlinEndpointFromAzure(client, resourceGroup, databaseAccount.name);
                    return new GraphAccountTreeItem(this, databaseAccount.id, label, databaseAccount.documentEndpoint, gremlinEndpoint, keyResult.primaryMasterKey, isEmulator, databaseAccount);
                }
                case "DocumentDB":
                default:
                    // Default to DocumentDB, the base type for all Cosmos DB Accounts
                    return new DocDBAccountTreeItem(this, databaseAccount.id, label, databaseAccount.documentEndpoint, keyResult.primaryMasterKey, isEmulator, databaseAccount);

            }
        }
    }
}
