/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureAccount, AzureSession } from './azure-account.api';
import { ResourceModels, ResourceManagementClient, SubscriptionClient, SubscriptionModels } from 'azure-arm-resource';
import DocumentdbManagementClient = require("azure-arm-documentdb");
import docDBModels = require("azure-arm-documentdb/lib/models");
import { IAzureNode, AzureTreeDataProvider, UserCancelledError } from 'vscode-azureextensionui';

export async function createCosmosDBAccount(subscriptionNode: IAzureNode, showCreatingNode: (label: string) => void): Promise<docDBModels.DatabaseAccount> {
    const resourceGroupPick = await getOrCreateResourceGroup(subscriptionNode);

    if (resourceGroupPick) {
        const accountName = await getCosmosDBAccountName(subscriptionNode);

        if (accountName) {
            const apiPick = await getCosmosDBApi();

            if (apiPick) {
                const locationPick = await vscode.window.showQuickPick(
                    getLocationQuickPicks(subscriptionNode),
                    { placeHolder: "Select a location to create your Comsmos DB account in...", ignoreFocusOut: true }
                );

                if (locationPick) {
                    return await vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (progress) => {
                        showCreatingNode(accountName);
                        progress.report({ message: `Cosmos DB: Creating account '${accountName}'` });
                        const docDBClient = new DocumentdbManagementClient(
                            subscriptionNode.credentials, subscriptionNode.subscription.subscriptionId);
                        await docDBClient.databaseAccounts.createOrUpdate(resourceGroupPick.resourceGroup.name,
                            accountName,
                            {
                                location: locationPick.location.name,
                                locations: [{ locationName: locationPick.location.name }],
                                kind: apiPick.kind,
                                tags: { defaultExperience: apiPick.defaultExperience }
                            });

                        // createOrUpdate always returns an empty object - so we have to get the DatabaseAccount separately
                        return await docDBClient.databaseAccounts.get(resourceGroupPick.resourceGroup.name, accountName);
                    });
                }
            }
        }
    }

    throw new UserCancelledError();
}

async function createResourceGroup(subscriptionNode: IAzureNode): Promise<ResourceModels.ResourceGroup> {
    const resourceGroupName = await vscode.window.showInputBox({
        placeHolder: "Resource Group Name",
        prompt: "Provide a resource group name",
        validateInput: validateResourceGroupName,
        ignoreFocusOut: true
    });

    if (resourceGroupName) {
        const locationPick = await vscode.window.showQuickPick(
            getLocationQuickPicks(subscriptionNode),
            { placeHolder: "Select a location to create your Resource Group in...", ignoreFocusOut: true }
        );

        if (locationPick) {
            return vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (progress) => {
                progress.report({ message: `Cosmos DB: Creating resource group '${resourceGroupName}'` });
                const resourceManagementClient = new ResourceManagementClient(subscriptionNode.credentials, subscriptionNode.subscription.subscriptionId);
                return resourceManagementClient.resourceGroups.createOrUpdate(resourceGroupName, { location: locationPick.location.name });
            });
        }
    }
}

async function getCosmosDBAccountName(subscriptionNode: IAzureNode): Promise<string> {
    const docDBClient = new DocumentdbManagementClient(subscriptionNode.credentials, subscriptionNode.subscription.subscriptionId);

    let nameNotAvailable = true;
    while (nameNotAvailable) {
        const accountName = await vscode.window.showInputBox({
            placeHolder: "Account name",
            prompt: "Provide a Cosmos DB account name",
            validateInput: validateCosmosDBAccountName,
            ignoreFocusOut: true
        });

        if (!accountName) {
            // If the user escaped the input box, exit the while loop
            break;
        } else {
            try {
                nameNotAvailable = await docDBClient.databaseAccounts.checkNameExists(accountName);
                if (nameNotAvailable) {
                    await vscode.window.showErrorMessage(`Account name '${accountName}' is not available.`)
                } else {
                    return accountName;
                }
            } catch (error) {
                await vscode.window.showErrorMessage(error.message);
            }
        }
    }
}

function getCosmosDBApi(): Thenable<ApiQuickPick> {
    const mongoDB = "MongoDB";
    const globalDocumentDB = "GlobalDocumentDB";
    const graph = "Graph";
    const table = "Table";
    const documentDB = "DocumentDB";

    const quickPicks: ApiQuickPick[] = [
        new ApiQuickPick(mongoDB, mongoDB),
        new ApiQuickPick(globalDocumentDB, graph),
        new ApiQuickPick(globalDocumentDB, table),
        new ApiQuickPick(globalDocumentDB, documentDB)
    ];

    return vscode.window.showQuickPick(quickPicks, { placeHolder: "Select an API for your Cosmos DB account...", ignoreFocusOut: true });
}

async function getLocationQuickPicks(subscriptionNode: IAzureNode): Promise<LocationQuickPick[]> {
    const subscriptionClient = new SubscriptionClient(subscriptionNode.credentials);
    const locations = await subscriptionClient.subscriptions.listLocations(subscriptionNode.subscription.subscriptionId);
    return locations.map(l => new LocationQuickPick(l));
}

async function getOrCreateResourceGroup(subscriptionPick: IAzureNode): Promise<ResourceGroupQuickPick> {
    const pick = await vscode.window.showQuickPick(
        getResourceGroupQuickPicks(subscriptionPick),
        { placeHolder: "Select a resource group to create your Cosmos DB account in...", ignoreFocusOut: true }
    );

    if (pick) {
        if (pick instanceof (ResourceGroupQuickPick)) {
            return pick;
        } else {
            const newGroup = await createResourceGroup(subscriptionPick);
            if (newGroup) {
                return new ResourceGroupQuickPick(newGroup);
            }
        }
    }
}

async function getResourceGroupQuickPicks(subscriptionNode: IAzureNode): Promise<vscode.QuickPickItem[]> {
    const resourceManagementClient = new ResourceManagementClient(subscriptionNode.credentials, subscriptionNode.subscription.subscriptionId);
    const existingGroups = await resourceManagementClient.resourceGroups.list();
    let quickPicks: vscode.QuickPickItem[] = [{
        label: "$(plus) Create Resource Group",
        description: null
    }];
    return quickPicks.concat(existingGroups.map(rg => new ResourceGroupQuickPick(rg)));
}

function validateCosmosDBAccountName(name: string): string {
    const min = 3;
    const max = 31;
    if (!name || name.length < min || name.length > max) {
        return `The name must be between ${min} and ${max} characters.`;
    } else if (name.match(/[^a-z0-9-]/)) {
        return "The name can only contain lowercase letters, numbers, and the '-' character.";
    }
}

function validateResourceGroupName(name: string): string {
    const min = 1;
    const max = 90;
    if (!name || name.length < min || name.length > max) {
        return `The name must be between ${min} and ${max} characters.`;
    } else if (name.match(/[^a-zA-Z0-9\.\_\-\(\)]/)) {
        return "The name can only contain alphanumeric characters or the symbols ._-()";
    } else if (name.endsWith('.')) {
        return "The name cannot end in a period."
    }
}

export class LocationQuickPick implements vscode.QuickPickItem {
    readonly label: string;
    readonly description: string;
    constructor(readonly location: SubscriptionModels.Location) {
        this.label = location.displayName;
        this.description = '';
    }
}

export class ApiQuickPick implements vscode.QuickPickItem {
    readonly label: string;
    readonly description: string;
    constructor(readonly kind: string, readonly defaultExperience: string) {
        this.label = defaultExperience;
    }
}

export class ResourceGroupQuickPick implements vscode.QuickPickItem {
    readonly label: string;
    readonly description: string;
    constructor(readonly resourceGroup: ResourceModels.ResourceGroup) {
        this.label = resourceGroup.name;
        this.description = resourceGroup.location;
    }
}
