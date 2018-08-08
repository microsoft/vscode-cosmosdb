/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from 'azure-arm-cosmosdb';
import { DatabaseAccount, DatabaseAccountListKeysResult, DatabaseAccountsListResult } from 'azure-arm-cosmosdb/lib/models';
import * as vscode from 'vscode';
import { AzureWizard, IActionContext, IAzureNode, IAzureTreeItem, IChildProvider, LocationListStep, parseError, ResourceGroupListStep } from 'vscode-azureextensionui';
import { getCosmosDBManagementClient } from '../docdb/getCosmosDBManagementClient';
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

export class CosmosDBAccountProvider implements IChildProvider {
    public childTypeLabel: string = 'Account';

    public hasMoreChildren(): boolean {
        return false;
    }

    public async loadMoreChildren(node: IAzureNode): Promise<IAzureTreeItem[]> {
        const client = getCosmosDBManagementClient(node.credentials, node.subscriptionId, node.environment.resourceManagerEndpointUrl);
        const accounts: DatabaseAccountsListResult = await client.databaseAccounts.list();
        let accountTreeItems = [];
        await Promise.all(
            accounts.map(async (databaseAccount: DatabaseAccount) => {
                try {
                    let account = await this.initChild(client, databaseAccount);
                    accountTreeItems.push(account);
                } catch (e) {
                    const err = parseError(e);
                    //tslint:disable-next-line:no-non-null-assertion
                    accountTreeItems.push(<IAzureTreeItem>{ label: databaseAccount!.name, description: "Invalid: " + err.message });
                }

            })
        );
        return accountTreeItems;
    }

    public async createChild(node: IAzureNode, showCreatingNode: (label: string) => void, actionContext?: IActionContext): Promise<IAzureTreeItem> {
        const client = getCosmosDBManagementClient(node.credentials, node.subscriptionId, node.environment.resourceManagerEndpointUrl);
        const wizardContext: ICosmosDBWizardContext = {
            credentials: node.credentials,
            subscriptionId: node.subscriptionId,
            subscriptionDisplayName: node.subscriptionDisplayName,
            environment: node.environment
        };

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
            showCreatingNode(wizardContext.accountName);
            progress.report({ message: `Cosmos DB: Creating account '${wizardContext.accountName}'` });
            await wizard.execute(actionContext);
        });
        return await this.initChild(client, wizardContext.databaseAccount);
    }

    private async initChild(client: CosmosDBManagementClient, databaseAccount: DatabaseAccount): Promise<IAzureTreeItem> {
        const defaultExperience = <API>(databaseAccount && databaseAccount.tags && databaseAccount.tags.defaultExperience);
        const resourceGroup: string = azureUtils.getResourceGroupFromId(databaseAccount.id);
        const accountKind = getExperience(defaultExperience).shortName;
        const label: string = databaseAccount.name + (accountKind ? ` (${accountKind})` : ``);
        const isEmulator: boolean = false;
        if (defaultExperience === "MongoDB") {
            const result = await client.databaseAccounts.listConnectionStrings(resourceGroup, databaseAccount.name);
            // Use the default connection string
            return new MongoAccountTreeItem(databaseAccount.id, label, result.connectionStrings[0].connectionString, isEmulator);
        } else {
            const keyResult: DatabaseAccountListKeysResult = await client.databaseAccounts.listKeys(resourceGroup, databaseAccount.name);
            switch (defaultExperience) {
                case "Table":
                    return new TableAccountTreeItem(databaseAccount.id, label, databaseAccount.documentEndpoint, keyResult.primaryMasterKey, isEmulator);
                case "Graph": {
                    const gremlinEndpoint = await TryGetGremlinEndpointFromAzure(client, resourceGroup, databaseAccount.name);
                    return new GraphAccountTreeItem(databaseAccount.id, label, databaseAccount.documentEndpoint, gremlinEndpoint, keyResult.primaryMasterKey, isEmulator);
                }
                case "DocumentDB":
                default:
                    // Default to DocumentDB, the base type for all Cosmos DB Accounts
                    return new DocDBAccountTreeItem(databaseAccount.id, label, databaseAccount.documentEndpoint, keyResult.primaryMasterKey, isEmulator);

            }
        }
    }
}
