/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { type DatabaseAccountListKeysResult } from '@azure/arm-cosmosdb/src/models';
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { SERVERLESS_CAPABILITY_NAME } from '../../constants';
import { parseDocDBConnectionString } from '../../docdb/docDBConnectionStrings';
import {
    AuthenticationMethod,
    getCosmosClient,
    type CosmosDBCredential,
    type CosmosDBKeyCredential,
} from '../../docdb/getCosmosClient';
import { ext } from '../../extensionVariables';
import { createCosmosDBManagementClient } from '../../utils/azureClients';
import { nonNullProp } from '../../utils/nonNull';
import { type CosmosAccountModel } from '../CosmosAccountModel';
import { type CosmosDBAttachedAccountModel } from '../workspace/CosmosDBAttachedAccountModel';

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
        throw new Error(l10n.t('Failed to connect to Cosmos DB account'));
    }

    const databaseAccount = await client.databaseAccounts.get(resourceGroup, name);
    const tenantId = account?.subscription?.tenantId;
    const credentials = await getCredentialsForGeneric(name, resourceGroup, tenantId, client, databaseAccount);
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
    tenantId: string,
    client: CosmosDBManagementClient,
    databaseAccount: DatabaseAccountGetResults,
): Promise<CosmosDBCredential[]> {
    const result = await callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
        context.valuesToMask.push(name, resourceGroup);
        context.telemetry.properties.attachedAccount = 'false';

        const preferredAuthenticationMethod = getPreferredAuthenticationMethod();

        let keyCred: CosmosDBKeyCredential | undefined = undefined;

        if (
            preferredAuthenticationMethod === AuthenticationMethod.accountKey ||
            preferredAuthenticationMethod === AuthenticationMethod.auto
        ) {
            try {
                const localAuthDisabled = databaseAccount.disableLocalAuth === true;
                context.telemetry.properties.localAuthDisabled = localAuthDisabled.toString();

                let keyResult: DatabaseAccountListKeysResult | undefined;
                // If the account has local auth disabled, don't even try to use key auth
                if (!localAuthDisabled) {
                    keyResult = await client.databaseAccounts.listKeys(resourceGroup, name);
                    keyCred = keyResult?.primaryMasterKey
                        ? {
                              type: AuthenticationMethod.accountKey,
                              key: keyResult.primaryMasterKey,
                          }
                        : undefined;
                    context.telemetry.properties.receivedKeyCreds = 'true';
                } else {
                    throw new Error(l10n.t('Local auth is disabled'));
                }
            } catch {
                context.telemetry.properties.receivedKeyCreds = 'false';
                logLocalAuthDisabledWarningIfPreferred(name, preferredAuthenticationMethod);
            }
        }

        // OAuth is always enabled for Cosmos DB and will be used as a fallback if key auth is unavailable
        const authCred = { type: AuthenticationMethod.entraId, tenantId: tenantId };
        return [keyCred, authCred].filter((cred) => cred !== undefined) as CosmosDBCredential[];
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

        const preferredAuthenticationMethod = getPreferredAuthenticationMethod();

        let keyCred: CosmosDBKeyCredential | undefined = undefined;
        let localAuthDisabled = false;

        if (
            preferredAuthenticationMethod === AuthenticationMethod.accountKey ||
            preferredAuthenticationMethod === AuthenticationMethod.auto ||
            account.isEmulator
        ) {
            const parsedCS = parseDocDBConnectionString(account.connectionString);
            if (parsedCS.masterKey) {
                context.telemetry.properties.receivedKeyCreds = 'true';

                keyCred = {
                    type: AuthenticationMethod.accountKey,
                    key: parsedCS.masterKey,
                };

                // If the account is the emulator, we just return the only supported key credential
                if (account.isEmulator) {
                    return [keyCred];
                }

                try {
                    // Since here we don't have subscription,
                    // we can't get DatabaseAccountGetResults to retrieve disableLocalAuth property
                    // Will try to connect to the account and catch if it fails due to local auth being disabled.
                    const cosmosClient = getCosmosClient(parsedCS.documentEndpoint, [keyCred], account.isEmulator);
                    await cosmosClient.getDatabaseAccount();
                } catch (e) {
                    const error = parseError(e);
                    // handle errors caused by local auth being disabled only, all other errors will be thrown
                    if (error.message.includes('Local Authorization is disabled.')) {
                        context.telemetry.properties.receivedKeyCreds = 'false';
                        localAuthDisabled = true;
                    }
                }
            }

            context.telemetry.properties.localAuthDisabled = localAuthDisabled.toString();
            if (localAuthDisabled && !account.isEmulator) {
                // Clean up keyCred if local auth is disabled
                keyCred = undefined;
                logLocalAuthDisabledWarningIfPreferred(account.name, preferredAuthenticationMethod);
            }
        }

        // OAuth is always enabled for Cosmos DB and will be used as a fallback if key auth is unavailable
        // TODO: we need to preserve the tenantId in the connection string, otherwise we can't use OAuth for foreign tenants
        const authCred = { type: AuthenticationMethod.entraId, tenantId: undefined };
        return [keyCred, authCred].filter((cred) => cred !== undefined) as CosmosDBCredential[];
    });

    return result ?? [];
}

function getPreferredAuthenticationMethod(): AuthenticationMethod {
    const configuration = vscode.workspace.getConfiguration();
    //migrate old setting
    const deprecatedOauthSetting = configuration.get<boolean>('azureDatabases.useCosmosOAuth');
    let preferredAuthMethod = configuration.get<AuthenticationMethod>(
        ext.settingsKeys.cosmosDbAuthentication,
        AuthenticationMethod.auto,
    );

    if (deprecatedOauthSetting) {
        if (preferredAuthMethod === AuthenticationMethod.auto) {
            preferredAuthMethod = AuthenticationMethod.entraId;
            configuration.update(ext.settingsKeys.cosmosDbAuthentication, preferredAuthMethod, true);
        }
        configuration.update('azureDatabases.useCosmosOAuth', undefined, true);
    }

    return preferredAuthMethod;
}

function logLocalAuthDisabledWarningIfPreferred(name: string, authenticationMethod: AuthenticationMethod): void {
    if (authenticationMethod === AuthenticationMethod.accountKey) {
        const message = l10n.t(
            'You do not have the required permissions to list auth keys for "{account}", falling back to using Entra ID. You can change the preferred authentication method with the {settingId} setting.',
            {
                account: name,
                settingId: ext.settingsKeys.cosmosDbAuthentication,
            },
        );
        ext.outputChannel.warn(message);
        ext.outputChannel.show();
    }
}
