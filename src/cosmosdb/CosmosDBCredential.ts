/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { type CosmosDBManagementClient, type DatabaseAccountGetResults } from '@azure/arm-cosmosdb';
import { RestError } from '@azure/cosmos';
import { callWithTelemetryAndErrorHandling, parseError, type IActionContext } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { ext } from '../extensionVariables';
import { AuthenticationMethod, getPreferredAuthenticationMethod } from './AuthenticationMethod';
import { getCosmosClient } from './getCosmosClient';
import { getManagedIdentityAuth } from './utils/managedIdentityUtils';

export type CosmosDBKeyCredential = {
    type: AuthenticationMethod.accountKey;
    key: string;
};

export type CosmosDBEntraIdCredential = {
    type: AuthenticationMethod.entraId;
    tenantId: string | undefined;
};

export type CosmosDBManagedIdentityCredential = {
    type: AuthenticationMethod.managedIdentity;
    clientId: string | undefined;
};

export type CosmosDBCredential = CosmosDBKeyCredential | CosmosDBEntraIdCredential | CosmosDBManagedIdentityCredential;

export function getCosmosDBKeyCredential(credentials: CosmosDBCredential[]): CosmosDBKeyCredential | undefined {
    return credentials.filter(
        (cred): cred is CosmosDBKeyCredential => cred.type === AuthenticationMethod.accountKey,
    )[0];
}

export function getCosmosDBEntraIdCredential(credentials: CosmosDBCredential[]): CosmosDBEntraIdCredential | undefined {
    return credentials.filter(
        (cred): cred is CosmosDBEntraIdCredential => cred.type === AuthenticationMethod.entraId,
    )[0];
}

// Common credential retrieval function with source-specific parameters
export async function getCosmosDBCredentials(params: {
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

        // If the account has local auth disabled, don't even try to use key auth
        if (localAuthDisabled) {
            throw new Error(l10n.t('Local auth is disabled'));
        }
        const key: string | undefined =
            (await getPrimaryMasterKeyWithARM(client, resourceGroup, accountName)) ||
            (await getPrimaryReadonlyMasterKeyWithARM(client, resourceGroup, accountName));
        if (key) {
            keyCred = {
                type: AuthenticationMethod.accountKey,
                key: key,
            };
        }
    } finally {
        if (keyCred !== undefined) {
            context.telemetry.properties.hasKeyCred = 'true';
            context.valuesToMask.push(keyCred.key);
        } else {
            context.telemetry.properties.hasKeyCred = 'false';
            logLocalAuthDisabledWarning(accountName);
        }
    }
    return keyCred;
}

async function getPrimaryMasterKeyWithARM(
    client: CosmosDBManagementClient,
    resourceGroup: string,
    accountName: string,
): Promise<string | undefined> {
    try {
        const keyResult = await client.databaseAccounts.listKeys(resourceGroup, accountName);
        return keyResult?.primaryMasterKey;
    } catch (e: unknown) {
        if (e instanceof RestError && e.statusCode === 403) {
            return undefined;
        } else {
            throw e;
        }
    }
}

async function getPrimaryReadonlyMasterKeyWithARM(
    client: CosmosDBManagementClient,
    resourceGroup: string,
    accountName: string,
): Promise<string | undefined> {
    try {
        const readonlyKeyResult = await client.databaseAccounts.listReadOnlyKeys(resourceGroup, accountName);
        return readonlyKeyResult?.primaryReadonlyMasterKey;
    } catch (e: unknown) {
        if (e instanceof RestError && e.statusCode === 403) {
            return undefined;
        } else {
            throw e;
        }
    }
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
