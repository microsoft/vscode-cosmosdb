/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosDBManagementClient } from "@azure/arm-cosmosdb";
import { AccessToken } from "@azure/core-auth";
import { TreeElementBase, TreeElementWithId } from "@microsoft/vscode-azext-utils";
import { AzureResource, AzureSubscription } from "@microsoft/vscode-azureresources-api";
import * as vscode from "vscode";
import { CoreExperience } from "../../AzureDBExperiences";
import { getThemeAgnosticIconPath } from "../../constants";
import { getCosmosClient } from "../../docdb/getCosmosClient";
import { DocDBDatabaseItem } from "./DocDBDatabaseItem";
import { DocDBConnection } from "./DocDBElement";

// @todo: refactor the getToken function
async function getToken(subscription: AzureSubscription, scopes: string[]): Promise<AccessToken> {
    const session = await subscription.authentication.getSession(scopes);
    const token = session?.accessToken;
    return {
        token: token as string,
        expiresOnTimestamp: 0
    }
}

/**
 * Represents a CosmosDB server node in the tree view.
 */
export class DocDBAccountItem implements TreeElementWithId {
    public static contextValue: string = "cosmosDBDocumentServer";

    public id: string;
    public name: string;
    public resourceGroup: string;
    public subscription: AzureSubscription;

    constructor(element: AzureResource) {
        this.id = element.id;
        this.name = element.name;
        this.resourceGroup = element.resourceGroup ?? "";
        this.subscription = element.subscription;
    }

    public async getTreeItem(): Promise<vscode.TreeItem> {
        return {
            label: this._getLabel(),
            id: this.id,
            iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg'),
            contextValue: DocDBAccountItem.contextValue,
            collapsibleState: vscode.TreeItemCollapsibleState.Collapsed
        }
    }

    public async getChildren(): Promise<TreeElementBase[]> {
        const tokenCredential = {
            getToken: async (scopes: string[]) => getToken(this.subscription, scopes)
        };
        const managementClient = new CosmosDBManagementClient(
            tokenCredential,
            this.subscription.subscriptionId
        );
        const databaseAccount = await managementClient.databaseAccounts.get(this.resourceGroup, this.name);
        const endpoint = databaseAccount.documentEndpoint;
        if (!endpoint) {
            throw Error(`Unable to get cosmos resource item. documentEndpoint is not defined.`);
        }
        const keyResult = await managementClient.databaseAccounts.listKeys(this.resourceGroup, this.name);
        const key = keyResult.primaryMasterKey;
        if (!key) {
            throw Error(`Unable to get cosmos resource item. primaryMasterKey is not defined.`);
        }
        const client = getCosmosClient(endpoint, key, false);
        const databases = await client.databases.readAll().fetchAll();
        const connection: DocDBConnection = {
            type: "key",
            endpoint,
            key,
            isEmulator: false,
            getCosmosClient: () => client
        };
        const children = databases.resources.map((database) => new DocDBDatabaseItem(this, database, connection));

        if (!!children) {
            return children;
        } else {
            throw Error("Failed to get children");
        }
    }

    private _getLabel(): string {
        return `${this.name} (${CoreExperience.shortName})`;
    }
}
