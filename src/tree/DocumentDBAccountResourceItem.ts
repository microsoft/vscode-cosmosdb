/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { type DatabaseAccountListKeysResult } from '@azure/arm-cosmosdb/src/models';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import vscode from 'vscode';
import { type Experience } from '../AzureDBExperiences';
import { type CosmosDBCredential, type CosmosDBKeyCredential } from '../docdb/getCosmosClient';
import { createCosmosDBManagementClient } from '../utils/azureClients';
import { localize } from '../utils/localize';
import { nonNullProp } from '../utils/nonNull';
import { type CosmosAccountModel } from './CosmosAccountModel';
import { CosmosAccountResourceItemBase } from './CosmosAccountResourceItemBase';

export class DocumentDBAccountResourceItem extends CosmosAccountResourceItemBase {
    protected databaseAccount?: DatabaseAccountGetResults;
    protected credentials?: CosmosDBCredential[];
    protected documentEndpoint?: string;

    constructor(
        account: CosmosAccountModel,
        protected experience: Experience,
    ) {
        super(account);
    }

    protected getClient() {
        return callWithTelemetryAndErrorHandling(
            'CosmosAccountResourceItemBase.getClient',
            async (context: IActionContext) => {
                return createCosmosDBManagementClient(context, this.account.subscription);
            },
        );
    }

    protected async init(): Promise<void> {
        const id = nonNullProp(this.account, 'id');
        const name = nonNullProp(this.account, 'name');
        const resourceGroup = nonNullProp(this.account, 'resourceGroup');
        const client = await this.getClient();

        if (!client) {
            return;
        }

        const databaseAccount = await client.databaseAccounts.get(resourceGroup, name);
        this.credentials = await this.getCredentials(name, resourceGroup, client, databaseAccount);
        this.documentEndpoint = nonNullProp(databaseAccount, 'documentEndpoint', `of the database account ${id}`);
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
