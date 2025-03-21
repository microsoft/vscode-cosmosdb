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
import { getManagedIdentityAuth } from '../../docdb/utils/managedIdentityUtils';
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
            context.telemetry.suppressIfSuccessful = true;
            context.errorHandling.forceIncludeInReportIssueCommand = true;
            context.valuesToMask.push(account.subscription.subscriptionId);
            return createCosmosDBManagementClient(context, account.subscription);
        },
    );

    if (!client) {
        throw new Error(l10n.t('Failed to connect to Cosmos DB account'));
    }

    const databaseAccount = await client.databaseAccounts.get(resourceGroup, name);
    const tenantId = account?.subscription?.tenantId;
    const credentials = await getCosmosDBCredentials({
        accountName: name,
        documentEndpoint: nonNullProp(databaseAccount, 'documentEndpoint', `of the database account ${id}`),
        isEmulator: false,
        armClient: client,
        resourceGroup,
        databaseAccount,
        tenantId,
    });
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

async function getAccountInfoForAttached(account: CosmosDBAttachedAccountModel): Promise<AccountInfo> | never {
    const id = account.id;
    const name = account.name;
    const isEmulator = account.isEmulator;
    const parsedCS = parseDocDBConnectionString(account.connectionString);
    const documentEndpoint = parsedCS.documentEndpoint;
    const credentials = await getCosmosDBCredentials({
        accountName: name,
        documentEndpoint,
        isEmulator,
        masterKey: parsedCS.masterKey,
        tenantId: undefined,
    });
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

// Common credential retrieval function with source-specific parameters
async function getCosmosDBCredentials(params: {
    //context: IActionContext;
    accountName: string;
    documentEndpoint: string;
    isEmulator: boolean;

    // ARM-specific parameters
    armClient?: CosmosDBManagementClient;
    resourceGroup?: string;
    databaseAccount?: DatabaseAccountGetResults;

    // Connection string params
    masterKey?: string;
    tenantId?: string;
}): Promise<CosmosDBCredential[]> {
    const result = await callWithTelemetryAndErrorHandling('getCredentials', async (context: IActionContext) => {
        const { accountName, documentEndpoint, isEmulator, resourceGroup, tenantId, masterKey } = params;
        context.valuesToMask.push(accountName, documentEndpoint);
        if (resourceGroup) {
            context.valuesToMask.push(resourceGroup);
        }
        if (tenantId) {
            context.valuesToMask.push(tenantId);
        }
        if (masterKey) {
            context.valuesToMask.push(masterKey);
        }
        context.telemetry.properties.attachedAccount = 'false';
        const preferredAuthenticationMethod = getPreferredAuthenticationMethod();

        // Skip key retrieval if not preferred or not auto
        const shouldTryKeyAuth =
            preferredAuthenticationMethod === AuthenticationMethod.accountKey ||
            preferredAuthenticationMethod === AuthenticationMethod.auto ||
            isEmulator;

        let keyCred: CosmosDBKeyCredential | undefined = undefined;

        if (shouldTryKeyAuth) {
            // Handle emulator separately (simplest case)
            if (isEmulator && params.masterKey) {
                return [
                    {
                        type: AuthenticationMethod.accountKey,
                        key: params.masterKey,
                    },
                ] as CosmosDBCredential[];
            }

            // Try to get key credential from ARM if possible
            if (params.armClient && params.resourceGroup && params.databaseAccount) {
                const localAuthDisabled = params.databaseAccount.disableLocalAuth ?? false;
                keyCred = await getKeyCredentialWithARM(
                    context,
                    accountName,
                    params.resourceGroup,
                    params.armClient,
                    localAuthDisabled,
                );
            }
            // Otherwise try with masterKey if provided
            else if (params.masterKey) {
                keyCred = await getKeyCredentialWithoutARM(
                    context,
                    accountName,
                    documentEndpoint,
                    params.masterKey,
                    isEmulator,
                );
            }
        }

        const managedIdentityCred = await getManagedIdentityAuth(
            documentEndpoint,
            preferredAuthenticationMethod === AuthenticationMethod.managedIdentity,
        );

        // OAuth is always enabled for Cosmos DB and used as fallback
        // TODO: we need to preserve the tenantId in the connection string, otherwise we can't use EntraId for foreign tenants
        const entraIdCred = { type: AuthenticationMethod.entraId, tenantId: tenantId };
        const creds = [keyCred, entraIdCred, managedIdentityCred].filter(
            (cred) => cred !== undefined, // remove unavailable creds
        ) as CosmosDBCredential[];
        // Sort the creds so that the preferred method is first
        const preferredCreds = creds.filter((cred) => cred.type === preferredAuthenticationMethod);
        const otherCreds = creds.filter((cred) => cred.type !== preferredAuthenticationMethod);
        return [...preferredCreds, ...otherCreds];
    });
    return result ?? [];
}

// Helper function for ARM-based key retrieval
async function getKeyCredentialWithARM(
    context: IActionContext,
    accountName: string,
    resourceGroup: string,
    client: CosmosDBManagementClient,
    localAuthDisabled: boolean,
): Promise<CosmosDBKeyCredential | undefined> {
    let keyCred: CosmosDBKeyCredential | undefined = undefined;
    try {
        context.telemetry.properties.localAuthDisabled = localAuthDisabled.toString();

        let keyResult: DatabaseAccountListKeysResult | undefined;
        // If the account has local auth disabled, don't even try to use key auth
        if (!localAuthDisabled) {
            keyResult = await client.databaseAccounts.listKeys(resourceGroup, accountName);
            if (keyResult?.primaryMasterKey) {
                keyCred = {
                    type: AuthenticationMethod.accountKey,
                    key: keyResult.primaryMasterKey,
                };
                context.valuesToMask.push(keyCred.key);
            }
            context.telemetry.properties.receivedKeyCreds = 'true';
        } else {
            throw new Error(l10n.t('Local auth is disabled'));
        }
    } catch {
        context.telemetry.properties.receivedKeyCreds = 'false';
        logLocalAuthDisabledWarning(accountName);
    }
    return keyCred;
}

// Helper function for connection string based key retrieval
async function getKeyCredentialWithoutARM(
    context: IActionContext,
    accountName: string,
    documentEndpoint: string,
    masterKey: string,
    isEmulator: boolean,
): Promise<CosmosDBKeyCredential | undefined> {
    let keyCred: CosmosDBKeyCredential | undefined = undefined;
    let localAuthDisabled = false;

    if (masterKey) {
        context.telemetry.properties.receivedKeyCreds = 'true';

        keyCred = {
            type: AuthenticationMethod.accountKey,
            key: masterKey,
        };

        // If the account is the emulator, we just return the only supported key credential
        if (isEmulator) {
            return keyCred;
        }

        try {
            // Since here we don't have subscription,
            // we can't get DatabaseAccountGetResults to retrieve disableLocalAuth property
            // Will try to connect to the account and catch if it fails due to local auth being disabled.
            const cosmosClient = getCosmosClient(documentEndpoint, [keyCred], isEmulator);
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
    if (localAuthDisabled && !isEmulator) {
        // Clean up keyCred if local auth is disabled
        keyCred = undefined;
        logLocalAuthDisabledWarning(accountName);
    }
    return keyCred;
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

function logLocalAuthDisabledWarning(name: string): void {
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
