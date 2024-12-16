/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { type DatabaseAccountListKeysResult } from '@azure/arm-cosmosdb/src/models';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import { type BranchDataProvider } from '@microsoft/vscode-azureresources-api';
import * as vscode from 'vscode';
import { API, tryGetExperience } from '../AzureDBExperiences';
import { databaseAccountType } from '../constants';
import { type CosmosDBCredential, type CosmosDBKeyCredential } from '../docdb/getCosmosClient';
import { ext } from '../extensionVariables';
import { tryGetGremlinEndpointFromAzure } from '../graph/gremlinEndpoints';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { localize } from '../utils/localize';
import { nonNullProp } from '../utils/nonNull';
import { type CosmosAccountModel, type CosmosDBResource } from './CosmosAccountModel';
import { type CosmosDbTreeElement } from './CosmosDbTreeElement';
import { GraphAccountResourceItem } from './graph/GraphAccountResourceItem';
import { type MongoAccountModel } from './mongo/MongoAccountModel';
import { MongoAccountResourceItem } from './mongo/MongoAccountResourceItem';
import { NoSqlAccountResourceItem } from './nosql/NoSqlAccountResourceItem';
import { TableAccountResourceItem } from './table/TableAccountResourceItem';

export class CosmosDBBranchDataProvider
    extends vscode.Disposable
    implements BranchDataProvider<CosmosDBResource, CosmosDbTreeElement>
{
    private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<CosmosDbTreeElement | undefined>();

    constructor() {
        super(() => this.onDidChangeTreeDataEmitter.dispose());
    }

    get onDidChangeTreeData(): vscode.Event<CosmosDbTreeElement | undefined> {
        return this.onDidChangeTreeDataEmitter.event;
    }

    /**
     * This function is called for every element in the tree when expanding, the element being expanded is being passed as an argument
     */
    async getChildren(element: CosmosDbTreeElement): Promise<CosmosDbTreeElement[]> {
        const result = await callWithTelemetryAndErrorHandling(
            'CosmosDBBranchDataProvider.getChildren',
            async (context: IActionContext) => {
                const elementTreeItem = await element.getTreeItem();

                context.telemetry.properties.parentContext = elementTreeItem.contextValue ?? 'unknown';

                return (await element.getChildren?.())?.map((child) => {
                    return ext.state.wrapItemInStateHandling(child, (child: CosmosDbTreeElement) =>
                        this.refresh(child),
                    ) as CosmosDbTreeElement;
                });
            },
        );

        return result ?? [];
    }

    /**
     * This function is being called when the resource tree is being built, it is called for every top level of resources.
     * @param resource
     */
    async getResourceItem(resource: CosmosDBResource): Promise<CosmosDbTreeElement> {
        const resourceItem = await callWithTelemetryAndErrorHandling(
            'CosmosDBBranchDataProvider.getResourceItem',
            async (context: IActionContext) => {
                const id = nonNullProp(resource, 'id');
                const name = nonNullProp(resource, 'name');
                const type = nonNullProp(resource, 'type');
                const resourceGroup = nonNullProp(resource, 'resourceGroup');

                context.valuesToMask.push(id);
                context.valuesToMask.push(name);

                if (type.toLocaleLowerCase() === databaseAccountType.toLocaleLowerCase()) {
                    if (resource.subscription) {
                        // Tree view has subscription
                        const accountModel = resource as CosmosAccountModel;
                        const client = await createCosmosDBManagementClient(context, resource.subscription);
                        const databaseAccount = await client.databaseAccounts.get(resourceGroup, name);
                        const experience = tryGetExperience(databaseAccount);
                        const credentials = await this.getCredentials(name, resourceGroup, client, databaseAccount);
                        const documentEndpoint: string = nonNullProp(
                            databaseAccount,
                            'documentEndpoint',
                            `of the database account ${id}`,
                        );

                        if (experience) {
                            // TODO: Should we change the input element? Probably will be better to create a new one
                            accountModel.dbExperience = experience;
                        }

                        if (experience?.api === API.MongoDB) {
                            return new MongoAccountResourceItem(
                                accountModel as MongoAccountModel,
                                resource.subscription,
                            );
                        }

                        if (experience?.api === API.Core) {
                            return new NoSqlAccountResourceItem(accountModel, credentials, documentEndpoint);
                        }

                        if (experience?.api === API.Graph) {
                            const gremlinEndpoint = await tryGetGremlinEndpointFromAzure(client, resourceGroup, name);
                            return new GraphAccountResourceItem(
                                accountModel,
                                credentials,
                                documentEndpoint,
                                gremlinEndpoint,
                            );
                        }

                        if (experience?.api === API.Table) {
                            return new TableAccountResourceItem(accountModel, credentials, documentEndpoint);
                        }
                    } else {
                        // Workspace view doesn't have subscription. Not supported yet
                    }
                } else {
                    // Unknown resource type
                }

                return null as unknown as CosmosDbTreeElement;
            },
        );

        if (resourceItem) {
            return ext.state.wrapItemInStateHandling(resourceItem, (item: CosmosDbTreeElement) =>
                this.refresh(item),
            ) as CosmosDbTreeElement;
        }

        return null as unknown as CosmosDbTreeElement;
    }

    async getTreeItem(element: CosmosDbTreeElement): Promise<vscode.TreeItem> {
        return element.getTreeItem();
    }

    refresh(element?: CosmosDbTreeElement): void {
        this.onDidChangeTreeDataEmitter.fire(element);
    }

    private async getCredentials(
        name: string,
        resourceGroup: string,
        client: CosmosDBManagementClient,
        databaseAccount: DatabaseAccountGetResults,
    ): Promise<CosmosDBCredential[]> {
        const result = await callWithTelemetryAndErrorHandling(
            'CosmosDBBranchDataProvider.getCredentials',
            async (context: IActionContext) => {
                const localAuthDisabled = databaseAccount.disableLocalAuth === true;
                const forceOAuth = vscode.workspace.getConfiguration().get<boolean>('azureDatabases.useCosmosOAuth');
                context.telemetry.properties.useCosmosOAuth = (forceOAuth ?? false).toString();

                let keyCred: CosmosDBKeyCredential | undefined = undefined;
                // disable key auth if the user has opted in to OAuth (AAD/Entra ID)
                if (!forceOAuth) {
                    try {
                        context.telemetry.properties.localAuthDisabled = localAuthDisabled.toString();

                        let keyResult: DatabaseAccountListKeysResult | undefined;
                        // If the account has local auth disabled, don't even try to use key auth
                        if (!localAuthDisabled) {
                            keyResult = await client.databaseAccounts.listKeys(resourceGroup, name);
                            keyCred = keyResult?.primaryMasterKey
                                ? {
                                      type: 'key',
                                      key: keyResult.primaryMasterKey,
                                  }
                                : undefined;
                            context.telemetry.properties.receivedKeyCreds = 'true';
                        } else {
                            throw new Error('Local auth is disabled');
                        }
                    } catch {
                        context.telemetry.properties.receivedKeyCreds = 'false';
                        const message = localize(
                            'keyPermissionErrorMsg',
                            'You do not have the required permissions to list auth keys for [{0}].\nFalling back to using Entra ID.\nYou can change the default authentication in the settings.',
                            name,
                        );
                        const openSettingsItem = localize('openSettings', 'Open Settings');
                        void vscode.window.showWarningMessage(message, ...[openSettingsItem]).then((item) => {
                            if (item === openSettingsItem) {
                                void vscode.commands.executeCommand(
                                    'workbench.action.openSettings',
                                    'azureDatabases.useCosmosOAuth',
                                );
                            }
                        });
                    }
                }

                // OAuth is always enabled for Cosmos DB and will be used as a fallback if key auth is unavailable
                const authCred = { type: 'auth' };
                return [keyCred, authCred].filter((cred): cred is CosmosDBCredential => cred !== undefined);
            },
        );

        return result ?? [];
    }
}
