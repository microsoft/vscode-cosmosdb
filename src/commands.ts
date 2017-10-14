/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as util from "./util";
import { AzureAccount, AzureSession } from './azure-account.api';
import { ResourceModels, ResourceManagementClient, SubscriptionClient, SubscriptionModels } from 'azure-arm-resource';
import DocumentdbManagementClient = require("azure-arm-documentdb");
import docDBModels = require("azure-arm-documentdb/lib/models");
import { DocumentClient } from 'documentdb';
import { DocumentBase } from 'documentdb/lib';
import { CosmosDBResourceNode } from './nodes';
import { DocDBDatabaseNode, DocDBCollectionNode, DocDBDocumentNode } from './docdb/nodes';
import { CosmosDBExplorer } from './explorer';

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

    public static async createDocDBDatabase(server: CosmosDBResourceNode, explorer: CosmosDBExplorer) {
        const databaseName = await vscode.window.showInputBox({
            placeHolder: 'Database Name',
            validateInput: CosmosDBCommands.validateDatabaseName,
            ignoreFocusOut: true
        });
        if (databaseName) {
            const masterKey = await server.getPrimaryMasterKey();
            const endpoint = await server.getEndpoint();
            const client = new DocumentClient(endpoint, { masterKey: masterKey });
            await new Promise((resolve, reject) => {
                client.createDatabase({ id: databaseName }, (err, result) => {
                    if (err) {
                        reject(err.body);
                    }
                    else {
                        resolve(result);
                    }
                });
            });
            const databaseNode = new DocDBDatabaseNode(databaseName, await server.getPrimaryMasterKey(), await server.getEndpoint(), server.defaultExperience, server);
            explorer.refresh(server);
            CosmosDBCommands.createDocDBCollection(databaseNode, explorer);
        }
    }

    public static async createDocDBDocument(coll: DocDBCollectionNode, explorer: CosmosDBExplorer) {
        const masterKey = coll.db.getPrimaryMasterKey();
        const endpoint = coll.db.getEndpoint();
        const client = new DocumentClient(endpoint, { masterKey: masterKey });
        const docid = await vscode.window.showInputBox({
            placeHolder: "Enter a unique id",
            ignoreFocusOut: true
        });
        await new Promise((resolve, reject) => {
            client.createDocument(coll.getCollLink(), { 'id': docid }, (err, result) => {
                if (err) {
                    reject(err.body);
                }
                else {
                    resolve(result);
                }
            });
        });
        explorer.refresh(coll);
    }


    public static async createDocDBCollection(db: DocDBDatabaseNode, explorer: CosmosDBExplorer) {
        const collectionName = await vscode.window.showInputBox({
            placeHolder: 'Collection Name',
            ignoreFocusOut: true
        });
        if (collectionName) {
            const masterKey = await db.getPrimaryMasterKey();
            const endpoint = await db.getEndpoint();
            let partitionKey: string = await vscode.window.showInputBox({
                prompt: 'Partition Key',
                ignoreFocusOut: true,
                validateInput: CosmosDBCommands.validatePartitionKey
            });
            if (partitionKey) {
                if (partitionKey[0] != '/') {
                    partitionKey = '/' + partitionKey;
                }
                const throughput: number = Number(await vscode.window.showInputBox({
                    value: '10000',
                    ignoreFocusOut: true,
                    prompt: 'Initial throughput capacity, between 2500 and 100,000',
                    validateInput: this.validateThroughput
                }));
                if (throughput) {
                    const client = new DocumentClient(endpoint, { masterKey: masterKey });
                    const options = { offerThroughput: throughput };
                    const collectionDef = {
                        id: collectionName,
                        partitionKey: {
                            paths: [partitionKey],
                            kind: DocumentBase.PartitionKind.Hash
                        }
                    };
                    await new Promise((resolve, reject) => {
                        client.createCollection(db.getDbLink(), collectionDef, options, (err, result) => {
                            if (err) {
                                reject(err.body);
                            }
                            else {
                                resolve(result);
                            }
                        });
                    });
                    explorer.refresh(db);
                }
            }
        }
    }

    private static validateDatabaseName(name: string): string | undefined | null {
        if (name.length < 1 || name.length > 255) {
            return "Name has to be between 1 and 255 chars long";
        }
        return undefined;
    }

    private static validatePartitionKey(key: string): string | undefined | null {
        if (/^[#?\\]*$/.test(key)) {
            return "Cannot contain these characters - ?,#,\\, etc."
        }
        return null;
    }

    private static validateThroughput(input: string): string | undefined | null {
        try {
            const value = Number(input);
            if (value < 2500 || value > 100000) {
                return "Value needs to lie between 2500 and 100,000"
            }
        } catch (err) {
            return "Input must be a number"
        }
        return null;
    }
    public static async deleteDocDBDatabase(db: DocDBDatabaseNode, explorer: CosmosDBExplorer): Promise<void> {
        if (db) {
            const confirmed = await vscode.window.showWarningMessage("Are you sure you want to delete database '" + db.label + "' and its collections?",
                "Yes", "No");
            if (confirmed === "Yes") {
                const masterKey = await db.getPrimaryMasterKey();
                const endpoint = await db.getEndpoint();
                const client = new DocumentClient(endpoint, { masterKey: masterKey });
                await new Promise((resolve, reject) => {
                    client.deleteDatabase(db.getDbLink(), function (err) {
                        err ? reject(new Error(err.body)) : resolve();
                    });
                });
                explorer.refresh(db.server);
            }
        }
    }
    public static async deleteDocDBCollection(coll: DocDBCollectionNode, explorer: CosmosDBExplorer): Promise<void> {
        if (coll) {
            const confirmed = await vscode.window.showWarningMessage("Are you sure you want to delete collection '" + coll.label + "'?", "Yes", "No");
            if (confirmed === "Yes") {
                const masterKey = await coll.db.getPrimaryMasterKey();
                const endpoint = await coll.db.getEndpoint();
                const client = new DocumentClient(endpoint, { masterKey: masterKey });
                const collLink = coll.getCollLink();
                await new Promise((resolve, reject) => {
                    client.deleteCollection(collLink, (err) => {
                        err ? reject(new Error(err.body)) : resolve();
                    });
                });
                explorer.refresh(coll.db);
            }
        }
    }

    public static async deleteDocDBDocument(doc: DocDBDocumentNode, explorer: CosmosDBExplorer): Promise<void> {
        if (doc) {
            const confirmed = await vscode.window.showWarningMessage("Are you sure you want to delete document '" + doc.label + "'?", "Yes", "No");
            if (confirmed === "Yes") {
                const masterKey = await doc.coll.db.getPrimaryMasterKey();
                const endpoint = await doc.coll.db.getEndpoint();
                const client = new DocumentClient(endpoint, { masterKey: masterKey });
                const docLink = doc.getDocLink();
                await new Promise((resolve, reject) => {
                    client.deleteDocument(docLink, (err) => {
                        err ? reject(new Error(err.body)) : resolve();
                    });
                });
                explorer.refresh(doc.coll);
            }
        }
    }

    public static async updateDocDBDocument(document: DocDBDocumentNode): Promise<void> {
        //get the data from the editor
        const masterKey = await document.coll.db.getPrimaryMasterKey();
        const endpoint = await document.coll.db.getEndpoint();
        const client = new DocumentClient(endpoint, { masterKey: masterKey });
        const editor = vscode.window.activeTextEditor;
        const newdocument = JSON.parse(editor.document.getText());
        const docLink = newdocument._self;
        await new Promise((resolve, reject) => {
            client.replaceDocument(docLink, newdocument,
                { accessCondition: { type: 'IfMatch', condition: newdocument._etag } },
                (err, updated) => {
                    if (err) {
                        reject(new Error(err.body));
                    }
                    else {
                        document.data = updated;
                        util.showResult(JSON.stringify(updated, null, 2));
                        resolve(updated);
                    }
                });
        });
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