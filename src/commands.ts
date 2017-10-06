/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AzureAccount, AzureSession } from './azure-account.api';
import { ResourceModels, ResourceManagementClient, SubscriptionClient, SubscriptionModels } from 'azure-arm-resource';
import DocumentdbManagementClient = require("azure-arm-documentdb");
import docDBModels = require("azure-arm-documentdb/lib/models");

export class CosmosDBCommands {
    public static async createCosmosDBAccount(azureAccount: AzureAccount): Promise<docDBModels.DatabaseAccount> {
        const subscriptionPick = await vscode.window.showQuickPick(
            this.getSubscriptionQuickPicks(azureAccount),
            { placeHolder: "Select a subscription to create your Cosmos DB account in...", ignoreFocusOut: true }
        );

        if (subscriptionPick) {
            const resourceGroupPick = await this.getOrCreateResourceGroup(subscriptionPick);

            if (resourceGroupPick) {
                const accountName = await this.getCosmosDBAccountName(subscriptionPick);

                if (accountName) {
                    const apiPick = await this.getCosmosDBApi();

                    if (apiPick) {
                        const locationPick = await vscode.window.showQuickPick(
                            this.getLocationQuickPicks(subscriptionPick),
                            { placeHolder: "Select a location to create your Comsmos DB account in...", ignoreFocusOut: true }
                        );

                        if (locationPick) {
                            return vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (progress) => {
                                progress.report({ message: `Cosmos DB: Creating account '${accountName}'` });
                                const docDBClient = new DocumentdbManagementClient(
                                    subscriptionPick.session.credentials, subscriptionPick.subscription.subscriptionId);
                                return docDBClient.databaseAccounts.createOrUpdate(resourceGroupPick.resourceGroup.name,
                                    accountName,
                                    {
                                        location: locationPick.location.name,
                                        locations: [{ locationName: locationPick.location.name }],
                                        kind: apiPick.kind,
                                        tags: { defaultExperience: apiPick.defaultExperience }
                                    });
                            });
                        }
                    }
                }
            }
        }
    }

    private static async createResourceGroup(subscriptionPick: SubscriptionQuickPick): Promise<ResourceModels.ResourceGroup> {
        const resourceGroupName = await vscode.window.showInputBox({
            placeHolder: "Resource Group Name",
            prompt: "Provide a resource group name",
            validateInput: this.validateResourceGroupName,
            ignoreFocusOut: true
        });

        if (resourceGroupName) {
            const locationPick = await vscode.window.showQuickPick(
                this.getLocationQuickPicks(subscriptionPick),
                { placeHolder: "Select a location to create your Resource Group in...", ignoreFocusOut: true }
            );

            if (locationPick) {
                return vscode.window.withProgress({ location: vscode.ProgressLocation.Window }, async (progress) => {
                    progress.report({ message: `Cosmos DB: Creating resource group '${resourceGroupName}'` });
                    const resourceManagementClient = new ResourceManagementClient(subscriptionPick.session.credentials, subscriptionPick.subscription.subscriptionId);
                    return resourceManagementClient.resourceGroups.createOrUpdate(resourceGroupName, { location: locationPick.location.name });
                });
            }
        }
    }

    private static async getCosmosDBAccountName(subscriptionPick: SubscriptionQuickPick): Promise<string> {
        const docDBClient = new DocumentdbManagementClient(subscriptionPick.session.credentials, subscriptionPick.subscription.subscriptionId);

        let nameNotAvailable = true;
        while (nameNotAvailable) {
            const accountName = await vscode.window.showInputBox({
                placeHolder: "Account name",
                prompt: "Provide a Cosmos DB account name",
                validateInput: this.validateCosmosDBAccountName,
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

    private static getCosmosDBApi(): Thenable<ApiQuickPick> {
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

    private static async getLocationQuickPicks(subscriptionPick: SubscriptionQuickPick): Promise<LocationQuickPick[]> {
        const subscriptionClient = new SubscriptionClient(subscriptionPick.session.credentials);
        const locations = await subscriptionClient.subscriptions.listLocations(subscriptionPick.subscription.subscriptionId);
        return locations.map(l => new LocationQuickPick(l));
    }

    private static async getOrCreateResourceGroup(subscriptionPick: SubscriptionQuickPick): Promise<ResourceGroupQuickPick> {
        const pick = await vscode.window.showQuickPick(
            this.getResourceGroupQuickPicks(subscriptionPick),
            { placeHolder: "Select a resource group to create your Cosmos DB account in...", ignoreFocusOut: true }
        );

        if (pick) {
            if (pick instanceof (ResourceGroupQuickPick)) {
                return pick;
            } else {
                const newGroup = await this.createResourceGroup(subscriptionPick);
                if (newGroup) {
                    return new ResourceGroupQuickPick(newGroup);
                }
            }
        }
    }

    private static async getResourceGroupQuickPicks(subscriptionPick: SubscriptionQuickPick): Promise<vscode.QuickPickItem[]> {
        const resourceManagementClient = new ResourceManagementClient(subscriptionPick.session.credentials, subscriptionPick.subscription.subscriptionId);
        const existingGroups = await resourceManagementClient.resourceGroups.list();
        let quickPicks: vscode.QuickPickItem[] = [{
            label: "$(plus) Create Resource Group",
            description: null
        }];
        return quickPicks.concat(existingGroups.map(rg => new ResourceGroupQuickPick(rg)));
    }

    private static async getSubscriptionQuickPicks(azureAccount: AzureAccount): Promise<SubscriptionQuickPick[]> {
        const quickPicks: SubscriptionQuickPick[] = [];

        await Promise.all(azureAccount.sessions.map(async session => {
            const subscriptionClient = new SubscriptionClient(session.credentials);
            const subscriptions = await subscriptionClient.subscriptions.list();
            subscriptions.forEach(sub => {
                const isDefault = azureAccount.filters.findIndex(filter => filter.subscription.id === sub.id) !== -1;
                quickPicks.push(new SubscriptionQuickPick(sub, session, isDefault));
            });
        }));

        quickPicks.sort((a, b) => {
            if (a.isDefault && !b.isDefault) {
                return -1;
            } else if (!a.isDefault && !b.isDefault) {
                return 1;
            } else {
                return a.label.localeCompare(b.label);
            }
        });

        return quickPicks;
    }

    private static validateCosmosDBAccountName(name: string): string {
        const min = 3;
        const max = 31;
        if (name.length < min || name.length > max) {
            return `The name must be between ${min} and ${max} characters.`;
        } else if (name.match(/[^a-z0-9-]/)) {
            return "The name can only contain lowercase letters, numbers, and the '-' character.";
        }
    }

    private static validateResourceGroupName(name: string): string {
        const min = 1;
        const max = 90;
        if (name.length < min || name.length > max) {
            return `The name must be between ${min} and ${max} characters.`;
        } else if (name.match(/[^a-zA-Z0-9\.\_\-\(\)]/)) {
            return "The name can only contain alphanumeric characters or the symbols ._-()";
        } else if (name.endsWith('.')) {
            return "The name cannot end in a period."
        }
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

export class SubscriptionQuickPick implements vscode.QuickPickItem {
    readonly label: string;
    readonly description: string;
    constructor(readonly subscription: SubscriptionModels.Subscription, readonly session: AzureSession, readonly isDefault: boolean) {
        this.label = isDefault ? `📌 ${subscription.displayName}` : subscription.displayName;
        this.description = subscription.subscriptionId;
    }
}