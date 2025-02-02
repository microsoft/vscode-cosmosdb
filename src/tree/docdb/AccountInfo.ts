/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { type DatabaseAccountListKeysResult } from '@azure/arm-cosmosdb/src/models';
import { callWithTelemetryAndErrorHandling, type IActionContext } from '@microsoft/vscode-azext-utils';
import vscode from 'vscode';
import { SERVERLESS_CAPABILITY_NAME } from '../../constants';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import { type CosmosDBCredential, type CosmosDBKeyCredential, getCosmosClient } from '../../docdb/getCosmosClient';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { localize } from '../../utils/localize';
import { nonNullProp } from '../../utils/nonNull';
import { type CosmosDBAttachedAccountModel } from '../attached/CosmosDBAttachedAccountModel';
import { type CosmosAccountModel } from '../CosmosAccountModel';

export interface AccountInfo {
    credentials: CosmosDBCredential[];
    endpoint: string;
    id: string;
    isEmulator: boolean;
    isServerless: boolean;
    name: string;
}

function isCosmosDBAttachedAccountModel(account: unknown): account is CosmosDBAttachedAccountModel {
    return (
        !!account &&
        typeof account === 'object' &&
        'connectionString' in account &&
        'id' in account &&
        'isEmulator' in account &&
        'name' in account
    );
}

export async function getAccountInfo(
    account: CosmosAccountModel | CosmosDBAttachedAccountModel,
): Promise<AccountInfo> | never {
    if (isCosmosDBAttachedAccountModel(account)) {
        return getAccountInfoForAttached(account);
    } else {
        return getAccountInfoForGeneric(account);
    }
}

async function getAccountInfoForGeneric(account: CosmosAccountModel): Promise<AccountInfo> | never {
    const id = nonNullProp(account, 'id');
    const name = nonNullProp(account, 'name');
    const resourceGroup = nonNullProp(account, 'resourceGroup');

    const client = await callWithTelemetryAndErrorHandling(
        'createCosmosDBManagementClient',
        async (context: IActionContext) => {
            return createCosmosDBManagementClient(context, account.subscription);
        },
    );

    if (!client) {
        throw new Error('Failed to connect to Cosmos DB account');
    }

    const databaseAccount = await client.databaseAccounts.get(resourceGroup, name);
    const credentials = await getCredentialsForGeneric(name, resourceGroup, client, databaseAccount);
    const documentEndpoint = nonNullProp(databaseAccount, 'documentEndpoint', `of the database account ${id}`);
    const isServerless = databaseAccount?.capabilities
        ? databaseAccount.capabilities.some((cap) => cap.name === SERVERLESS_CAPABILITY_NAME)
        : false;

    return {
        credentials,
        endpoint: documentEndpoint,
        id,
        isEmulator: false,
        isServerless,
        name,
    };
}

async function getCredentialsForGeneric(
    name: string,
    resourceGroup: string,
    client: CosmosDBManagementClient,
    databaseAccount: DatabaseAccountGetResults,
): Promise<CosmosDBCredential[]> {
    const result = await callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
        context.valuesToMask.push(name, resourceGroup);
        context.telemetry.properties.attachedAccount = 'false';

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

async function getAccountInfoForAttached(account: CosmosDBAttachedAccountModel): Promise<AccountInfo> | never {
    const id = account.id;
    const name = account.name;
    const isEmulator = account.isEmulator;
    const parsedCS = parseDocDBConnectionString(account.connectionString);
    const documentEndpoint = parsedCS.documentEndpoint;
    const credentials = await getCredentialsForAttached(account);
    const isServerless = false;

    return {
        credentials,
        endpoint: documentEndpoint,
        id,
        isEmulator,
        isServerless,
        name,
    };
}

async function getCredentialsForAttached(account: CosmosDBAttachedAccountModel): Promise<CosmosDBCredential[]> {
    const result = await callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
        context.valuesToMask.push(account.connectionString);
        context.telemetry.properties.attachedAccount = 'true';

        const forceOAuth = vscode.workspace.getConfiguration().get<boolean>('azureDatabases.useCosmosOAuth');
        context.telemetry.properties.useCosmosOAuth = (forceOAuth ?? false).toString();

        let keyCred: CosmosDBKeyCredential | undefined = undefined;
        // disable key auth if the user has opted in to OAuth (AAD/Entra ID)
        if (!forceOAuth) {
            let localAuthDisabled = false;

            const parsedCS = parseDocDBConnectionString(account.connectionString);
            if (parsedCS.masterKey) {
                context.telemetry.properties.receivedKeyCreds = 'true';

                keyCred = {
                    type: 'key',
                    key: parsedCS.masterKey,
                };

                try {
                    // Since here we don't have subscription,
                    // we can't get DatabaseAccountGetResults to retrieve disableLocalAuth property
                    // Will try to connect to the account and if it fails, we will assume local auth is disabled
                    const cosmosClient = getCosmosClient(parsedCS.documentEndpoint, [keyCred], account.isEmulator);
                    await cosmosClient.getDatabaseAccount();
                } catch {
                    context.telemetry.properties.receivedKeyCreds = 'false';
                    localAuthDisabled = true;
                }
            }

            context.telemetry.properties.localAuthDisabled = localAuthDisabled.toString();
            if (localAuthDisabled) {
                // Clean up keyCred if local auth is disabled
                keyCred = undefined;

                const message = localize(
                    'keyPermissionErrorMsg',
                    'You do not have the required permissions to list auth keys for [{0}].\nFalling back to using Entra ID.\nYou can change the default authentication in the settings.',
                    account.name,
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
