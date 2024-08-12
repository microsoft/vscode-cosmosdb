/* eslint-disable @typescript-eslint/no-unused-vars */
// TODO: remove the eslint exception once this class is implemented
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    AzExtTreeItem,
    AzureWizard,
    IActionContext,
    ISubscriptionContext,
    callWithTelemetryAndErrorHandling,
    nonNullProp,
    nonNullValue,
} from '@microsoft/vscode-azext-utils';
import { AppResource, ResolvedAppResourceBase } from '@microsoft/vscode-azext-utils/hostapi';
import { getThemeAgnosticIconPath } from '../constants';
import { IMongoTreeRoot } from '../mongo/tree/IMongoTreeRoot';

import { createHttpHeaders } from '@azure/core-rest-pipeline';

import { getResourceGroupFromId } from '@microsoft/vscode-azext-azureutils';
import * as vscode from 'vscode';
import { createCosmosDBClient } from '../utils/azureClients';
import { localize } from '../utils/localize';
import { CredentialsStore } from '../vCore/CredentialsStore';
import { IVCoreClusterUser } from '../vCore/IVCoreClusterUser';
import { VCoreDatabaseTreeItem } from '../vCore/tree/VCoreDatabaseTreeItem';
import { addAuthenticationDataToConnectionString } from '../vCore/utils/connectionStringHelpers';
import { VCoreClient, vCoreDatabaseInfo } from '../vCore/VCoreClient';
import { IAuthenticateWizardContext } from '../vCore/wizards/authenticate/IAuthenticateWizardContext';
import { ProvidePasswordStep } from '../vCore/wizards/authenticate/ProvidePasswordStep';
import { SelectUserNameStep } from '../vCore/wizards/authenticate/SelectUserNameStep';

export interface IDatabaseInfo {
    name?: string;
    empty?: boolean;
    version?: string;
}

export interface IMongoVCoreAccountDetails {
    name: string;
    version?: string;
    sku?: string;
    diskSize?: number;
    provisioningState?: string;
    clusterStatus?: string;
    publicNetworkAccess?: string;
    location?: string;
}

export class ResolvedMongoVCoreAccountResource implements ResolvedAppResourceBase {
    public static kind = 'microsoft.documentdb/mongoclusters' as const;

    public static contextValue: string = 'cosmosDBMongoServer';
    //public readonly contextValue: string = MongoVCoreAccountTreeItem.contextValue;
    public readonly childTypeLabel: string = 'Database';
    public readonly label: string;
    public readonly connectionString: string;
    // private readonly subscriptionContext: ISubscriptionContext;

    private _root: IMongoTreeRoot;

    constructor(
        subContext: ISubscriptionContext,
        id: string,
        accountDetails: IMongoVCoreAccountDetails,
        resource: AppResource,
    ) {
        //super(undefined);
        //this.subscriptionContext = subContext;
        this.id = id;
        this.label = accountDetails.name;
        this._resource = resource;
        this._subscription = subContext;
        this.description = `(${accountDetails.sku} + ${accountDetails.diskSize}GB)`;
        this.tooltip =
            `SKU: ${accountDetails.sku}\n` +
            `Disk Size: ${accountDetails.diskSize}GB\n` +
            `Version: v${accountDetails.version}\n` +
            `\n` +
            `Resource Group: ${getResourceGroupFromId(resource.id)}\n` +
            `Location: ${accountDetails.location}\n` +
            `\n` +
            `Provisioning State: ${accountDetails.provisioningState}\n` +
            `Cluster Status: ${accountDetails.clusterStatus}\n`;

        //this.connectionString = connectionString;
        //this._root = { isEmulator };
        //this.valuesToMask.push(connectionString);
    }
    _resource: AppResource;
    _subscription: ISubscriptionContext;
    kind: 'microsoft.documentdb/mongoclusters';
    fullId?: undefined;
    parent?: undefined;
    treeDataProvider?: undefined;
    valuesToMask?: undefined;
    collapsibleState?: undefined;
    suppressMaskLabel?: undefined;
    id?: string | undefined;
    description?: string | undefined;
    commandId?: string | undefined;
    tooltip?: string | undefined;
    initialCollapsibleState?: vscode.TreeItemCollapsibleState | undefined;
    commandArgs?: unknown[] | undefined;
    contextValue?: undefined;

    // createChildImpl?(context: ICreateChildImplContext): Promise<AzExtTreeItem> {
    //     throw new Error('Method not implemented.');
    // }
    // compareChildrenImpl?(item1: AzExtTreeItem, item2: AzExtTreeItem): number {
    //     throw new Error('Method not implemented.');
    // }
    // pickTreeItemImpl?(expectedContextValues: (string | RegExp)[], context: IActionContext): AzExtTreeItem | Promise<AzExtTreeItem | undefined> | undefined {
    //     throw new Error('Method not implemented.');
    // }
    // deleteTreeItemImpl?(context: IActionContext): Promise<void> {
    //     throw new Error('Method not implemented.');
    // }
    // refreshImpl?(context: IActionContext): Promise<void> {
    //     throw new Error('Method not implemented.');
    // }
    // isAncestorOfImpl?(contextValue: string | RegExp): boolean {
    //     throw new Error('Method not implemented.');
    // }
    // resolveTooltip?(): Promise<string | vscode.MarkdownString> {
    //     throw new Error('Method not implemented.');
    // }
    contextValuesToAdd?: string[] | undefined;

    // overrides ISubscriptionContext with an object that also has Mongo info
    public get root(): IMongoTreeRoot {
        return this._root;
    }

    public get iconPath(): string | vscode.Uri | { light: string | vscode.Uri; dark: string | vscode.Uri } {
        return getThemeAgnosticIconPath('CosmosDBAccount.svg');
    }

    public hasMoreChildrenImpl(): boolean {
        return false;
    }

    public async loadMoreChildrenImpl(_clearCache: boolean): Promise<AzExtTreeItem[]> {
        const result = await callWithTelemetryAndErrorHandling(
            'vCore.loadMoreChildrenImpl',
            async (context: IActionContext): Promise<AzExtTreeItem[]> => {
                context.errorHandling.suppressDisplay = true;
                context.errorHandling.rethrow = true;

                void vscode.window.showInformationMessage('Loading Cluster Details for ' + this._resource.name + '...');
                const resourceGroupName = getResourceGroupFromId(nonNullProp(this._resource, 'id'));

                const client = await createCosmosDBClient({ ...context, ...this._subscription });
                const mongoCluster = await client.mongoClusters.get(resourceGroupName, this._resource.name);

                const login = mongoCluster.administratorLogin;
                const cString = mongoCluster.connectionString;

                // load users
                const getUsersResponse = await client.sendRequest({
                    method: 'GET',
                    url: `https://management.azure.com/subscriptions/${this._subscription.subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.DocumentDB/mongoClusters/${this._resource.name}/users?api-version=2024-03-01-preview`,
                    headers: createHttpHeaders({ 'Content-Type': 'application/json' }),
                    timeout: 0,
                    withCredentials: false,
                    requestId: '',
                });

                const clusterUsers: IVCoreClusterUser[] = nonNullProp(
                    JSON.parse(nonNullValue(getUsersResponse.bodyAsText, '[]') as string),
                    'value',
                ) as IVCoreClusterUser[];

                const clusterUsersNamesArray: string[] = clusterUsers
                    .filter((user) => user.name !== mongoCluster.administratorLogin)
                    .map((user) => user.name);

                const wizardContext: IAuthenticateWizardContext = {
                    ...context,
                    adminUserName: login as string,
                    otherUserNames: clusterUsersNamesArray,
                    resourceName: this._resource.name,
                };

                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const wizard = new AzureWizard(wizardContext, {
                    promptSteps: [new SelectUserNameStep(), new ProvidePasswordStep()],
                    title: localize('authenticatevCoreCluster', 'Authenticate to your vCore Cluster'),
                });

                await wizard.prompt();

                void vscode.window.showInformationMessage('Connecting to vCore...');

                const cStringPassword = addAuthenticationDataToConnectionString(
                    cString as string,
                    nonNullProp(wizardContext, 'selectedUserName'),
                    nonNullProp(wizardContext, 'password'),
                );
                const clientId = CredentialsStore.setConnectionString(cStringPassword);

                const vCoreClient: VCoreClient = await VCoreClient.getClient(clientId);

                void vscode.window.showInformationMessage('Listing databases...');

                return vCoreClient.listDatabases().then((databases: vCoreDatabaseInfo[]) => {
                    return databases.map((database) => new VCoreDatabaseTreeItem(database.name as string, clientId));
                });
            },
        );

        if (result === undefined) {
            return [];
        } else {
            return result;
        }
    }

    // try {

    //     const resourceGroupName = getResourceGroupFromId(nonNullProp(this._resource, 'id'));

    //     const client = await createCosmosDBClient({ context, ...this._subscription });

    //     const databaseAccount = await client.databaseAccounts.get(resourceGroupName, this.name);

    //     const result: AzExtTreeItem[] = [];
    //     result.push(new GenericTreeItem(undefined, {
    //         contextValue: 'cosmosDBAttachEmulator',
    //         label: 'Attach ',
    //         commandId: 'cosmosDB.attachEmulator',
    //         includeInTreeItemPicker: true
    //     }));

    //     return result;

    // } catch (error) {
    //     const message = parseError(error).message;
    //     if (this._root.isEmulator && message.includes("ECONNREFUSED")) {
    //         // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    //         error.message = `Unable to reach emulator. See ${Links.LocalConnectionDebuggingTips} for debugging tips.\n${message}`;
    //     }
    //     throw error;
    // }
    // return [];

    // public async createChildImpl(context: ICreateChildImplContext): Promise<MongoDatabaseTreeItem> {
    //     const databaseName = await context.ui.showInputBox({
    //         placeHolder: "Database Name",
    //         prompt: "Enter the name of the database",
    //         stepName: 'createMongoDatabase',
    //         validateInput: validateDatabaseName
    //     });
    //     context.showCreatingTreeItem(databaseName);

    //     return new MongoDatabaseTreeItem(this, databaseName, this.connectionString);
    // }

    // public isAncestorOfImpl(contextValue: string): boolean {
    //     switch (contextValue) {
    //         case MongoDatabaseTreeItem.contextValue:
    //         case MongoCollectionTreeItem.contextValue:
    //         case MongoDocumentTreeItem.contextValue:
    //             return true;
    //         default:
    //             return false;
    //     }
    // }

    // public async deleteTreeItemImpl(context: IDeleteWizardContext): Promise<void> {
    //     await deleteCosmosDBAccount(context, this);
    // }
}
