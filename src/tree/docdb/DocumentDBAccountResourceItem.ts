/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { type DatabaseAccountListKeysResult } from '@azure/arm-cosmosdb/src/models';
import { type CosmosClient, type DatabaseDefinition, type Resource } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import vscode, { type TreeItem } from 'vscode';
import { type Experience } from '../../AzureDBExperiences';
import { getThemeAgnosticIconPath } from '../../constants';
import { type CosmosDBCredential, type CosmosDBKeyCredential, getCosmosClient } from '../../docdb/getCosmosClient';
import { getSignedInPrincipalIdForAccountEndpoint } from '../../docdb/utils/azureSessionHelper';
import { ensureRbacPermissionV2, isRbacException, showRbacPermissionError } from '../../docdb/utils/rbacUtils';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { type CosmosAccountModel } from '../CosmosAccountModel';
import { CosmosDBAccountResourceItemBase } from '../CosmosDBAccountResourceItemBase';
import { type CosmosDBTreeElement } from '../CosmosDBTreeElement';
import { type AccountInfo } from './AccountInfo';

export abstract class DocumentDBAccountResourceItem extends CosmosDBAccountResourceItemBase {
    public declare readonly account: CosmosAccountModel;

    // To prevent the RBAC notification from showing up multiple times
    protected hasShownRbacNotification: boolean = false;

    protected constructor(account: CosmosAccountModel, experience: Experience) {
        super(account, experience);
    }

    public async getChildren(): Promise<CosmosDBTreeElement[]> {
        const accountInfo = await this.getAccountInfo(this.account);
        const cosmosClient = getCosmosClient(accountInfo.endpoint, accountInfo.credentials, false);
        const databases = await this.getDatabases(accountInfo, cosmosClient);

        return this.getChildrenImpl(accountInfo, databases);
    }

    public getTreeItem(): TreeItem {
        return { ...super.getTreeItem(), iconPath: getThemeAgnosticIconPath('CosmosDBAccount.svg') };
    }

    protected async getAccountInfo(account: CosmosAccountModel): Promise<AccountInfo> | never {
        const id = nonNullProp(account, 'id');
        const name = nonNullProp(account, 'name');
        const resourceGroup = nonNullProp(account, 'resourceGroup');

        const client = await callWithTelemetryAndErrorHandling('getAccountInfo', async (context: IActionContext) => {
            return createCosmosDBManagementClient(context, account.subscription);
        });

        if (!client) {
            throw new Error('Failed to connect to Cosmos DB account');
        }

        const databaseAccount = await client.databaseAccounts.get(resourceGroup, name);
        const credentials = await this.getCredentials(name, resourceGroup, client, databaseAccount);
        const documentEndpoint = nonNullProp(databaseAccount, 'documentEndpoint', `of the database account ${id}`);

        return {
            credentials,
            endpoint: documentEndpoint,
            id,
            isEmulator: false,
            name,
        };
    }

    protected async getDatabases(
        accountInfo: AccountInfo,
        cosmosClient: CosmosClient,
    ): Promise<(DatabaseDefinition & Resource)[]> | never {
        const getResources = async () => {
            const result = await cosmosClient.databases.readAll().fetchAll();
            return result.resources;
        };

        try {
            // Await is required here to ensure that the error is caught in the catch block
            return await getResources();
        } catch (e) {
            if (e instanceof Error && isRbacException(e) && !this.hasShownRbacNotification) {
                this.hasShownRbacNotification = true;

                const principalId = (await getSignedInPrincipalIdForAccountEndpoint(accountInfo.endpoint)) ?? '';
                // check if the principal ID matches the one that is signed in,
                // otherwise this might be a security problem, hence show the error message
                if (
                    e.message.includes(`[${principalId}]`) &&
                    (await ensureRbacPermissionV2(this.id, this.account.subscription, principalId))
                ) {
                    return getResources();
                } else {
                    void showRbacPermissionError(this.id, principalId);
                }
            }
            throw e; // rethrowing tells the resources extension to show the exception message in the tree
        }
    }

    protected async getCredentials(
        name: string,
        resourceGroup: string,
        client: CosmosDBManagementClient,
        databaseAccount: DatabaseAccountGetResults,
    ): Promise<CosmosDBCredential[]> {
        const result = await callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
            context.telemetry.properties.experience = this.experience.api;
            context.telemetry.properties.parentContext = this.contextValue;

            const forceOAuth = vscode.workspace.getConfiguration().get<boolean>('azureDatabases.useCosmosOAuth');
            context.telemetry.properties.useCosmosOAuth = (forceOAuth ?? false).toString();

            let keyCred: CosmosDBKeyCredential | undefined = undefined;
            // disable key auth if the user has opted in to OAuth (AAD/Entra ID)
            if (!forceOAuth) {
                try {
                    const localAuthDisabled = databaseAccount.disableLocalAuth === true;
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
        });

        return result ?? [];
    }

    protected abstract getChildrenImpl(
        accountInfo: AccountInfo,
        databases: (DatabaseDefinition & Resource)[],
    ): Promise<CosmosDBTreeElement[]>;
}
