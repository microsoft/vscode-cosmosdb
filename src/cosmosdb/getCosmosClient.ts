/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, type CosmosClientOptions } from '@azure/cosmos';
import { ManagedIdentityCredential } from '@azure/identity';
import { appendExtensionUserAgent } from '@microsoft/vscode-azext-utils';
import { merge } from 'es-toolkit';
import * as https from 'https';
import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { ext } from '../extensionVariables';
import { type AccountInfo } from '../tree/cosmosdb/AccountInfo';
import { AuthenticationMethod, getPreferredAuthenticationMethod } from './AuthenticationMethod';
import {
    getCosmosDBKeyCredential,
    type CosmosDBCredential,
    type CosmosDBEntraIdCredential,
    type CosmosDBManagedIdentityCredential,
} from './CosmosDBCredential';
import { isNoSqlQueryConnection, type NoSqlQueryConnection } from './NoSqlQueryConnection';
import { getAccessTokenForVSCode } from './utils/azureSessionHelper';

export type GetCosmosClientOptions = Partial<CosmosClientOptions> & {
    challenge?: string; // Optional challenge for EntraID authentication
};

export function getCosmosClient(connection: NoSqlQueryConnection, options?: GetCosmosClientOptions): CosmosClient;
export function getCosmosClient(accountInfo: AccountInfo, options?: GetCosmosClientOptions): CosmosClient;
export function getCosmosClient(
    endpoint: string,
    credentials: CosmosDBCredential[],
    isEmulator: boolean,
    options?: GetCosmosClientOptions,
): CosmosClient;
export function getCosmosClient(
    arg1: NoSqlQueryConnection | AccountInfo | string,
    arg2?: GetCosmosClientOptions | CosmosDBCredential[],
    arg3?: boolean,
    arg4?: GetCosmosClientOptions,
): CosmosClient {
    let endpoint: string;
    let credentials: CosmosDBCredential[];
    let isEmulator: boolean;
    let options: GetCosmosClientOptions | undefined;
    if (typeof arg1 === 'string') {
        // If the first argument is a string, it's the endpoint
        endpoint = arg1;
        credentials = arg2 as CosmosDBCredential[];
        isEmulator = arg3 ?? false;
        options = arg4;
    } else if (isNoSqlQueryConnection(arg1)) {
        // Otherwise, it's a NoSqlQueryConnection object
        const connection = arg1;
        endpoint = connection.endpoint;
        credentials = connection.credentials;
        isEmulator = connection.isEmulator;
        options = arg2 as GetCosmosClientOptions;
    } else {
        // Otherwise, it's an AccountInfo object
        const accountInfo = arg1 as AccountInfo;
        endpoint = accountInfo.endpoint;
        credentials = accountInfo.credentials;
        isEmulator = accountInfo.isEmulator;
        options = arg2 as GetCosmosClientOptions;
    }

    const vscodeStrictSSL: boolean | undefined = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    const enableEndpointDiscovery: boolean | undefined = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.enableEndpointDiscovery);
    const connectionPolicy = {
        enableEndpointDiscovery: enableEndpointDiscovery === undefined ? true : enableEndpointDiscovery,
    };

    const keyCred = getCosmosDBKeyCredential(credentials);

    const agent = endpoint.startsWith('https:')
        ? new https.Agent({ rejectUnauthorized: isEmulator ? !isEmulator : vscodeStrictSSL })
        : undefined;
    const commonProperties: CosmosClientOptions = {
        endpoint,
        userAgentSuffix: appendExtensionUserAgent(),
        agent: agent,
        connectionPolicy,
    };

    // we can only authenticate with CosmosDBKeyCredential or another at a time, we'll use the first one we find
    const nonKeyCredentials = credentials.filter((cred) => cred.type !== AuthenticationMethod.accountKey);

    // @todo: Add telemetry to monitor usage of each credential type
    if (keyCred) {
        commonProperties.key = keyCred?.key;
    } else if (nonKeyCredentials.length > 0) {
        commonProperties.aadCredentials = {
            getToken: async (scopes, _options) => {
                // Fix scopes for test environments
                const normalizedAuthScopes = normalizeCosmosScopes(scopes);

                // Track errors for better diagnostics
                const errors: string[] = [];

                async function tryCredential(
                    credential: CosmosDBCredential,
                    forcePrompt: boolean,
                ): Promise<{ token: string; expiresOnTimestamp: number } | null> {
                    try {
                        switch (credential.type) {
                            case AuthenticationMethod.accountKey:
                                // Account key should have been handled earlier and is not supported for AAD
                                return null;

                            case AuthenticationMethod.entraId: {
                                const { challenge } = options || {};
                                return getAccessTokenForVSCode(
                                    challenge ? { scopes: normalizedAuthScopes, challenge } : normalizedAuthScopes,
                                    (credential as CosmosDBEntraIdCredential).tenantId,
                                    { createIfNone: forcePrompt },
                                );
                            }

                            case AuthenticationMethod.managedIdentity: {
                                const { clientId } = credential as CosmosDBManagedIdentityCredential;
                                const auth = new ManagedIdentityCredential({ clientId });
                                return await auth.getToken(normalizedAuthScopes);
                            }

                            default:
                                errors.push(
                                    l10n.t('Unsupported credential type: {type}', {
                                        type: (credential as CosmosDBCredential).type,
                                    }),
                                );
                                return null;
                        }
                    } catch (e) {
                        const message = l10n.t('{type} auth failed: {error}', {
                            type: credential.type,
                            error: e instanceof Error ? e.message : String(e),
                        });
                        errors.push(message);
                        return null;
                    }
                }

                // THREE-STEP AUTHENTICATION STRATEGY:

                let firstIsPreferred = true;
                if (
                    credentials[0].type === AuthenticationMethod.entraId &&
                    getPreferredAuthenticationMethod() !== AuthenticationMethod.entraId
                ) {
                    // EntraID will always be first in the list, but we only want to prompt if it's the preferred method
                    firstIsPreferred = false;
                }

                // 1. Try preferred credential first (with prompting for EntraID if preferred)
                const preferredResult = await tryCredential(credentials[0], firstIsPreferred);
                if (preferredResult) return preferredResult;

                // 2. Try remaining credentials without prompting
                for (let i = 1; i < credentials.length; i++) {
                    const result = await tryCredential(credentials[i], false);
                    if (result) return result;
                }

                // 3. Last resort - Try EntraID again with forced prompting
                const entraIdCreds = credentials.filter(
                    (cred) => cred.type === AuthenticationMethod.entraId,
                ) as CosmosDBEntraIdCredential[];

                if (entraIdCreds.length > 0) {
                    // Force prompt on Entra ID as last resort
                    const result = await tryCredential(entraIdCreds[0], true);
                    if (result) return result;

                    errors.push(l10n.t('Last-resort interactive EntraID authentication failed'));
                }

                // All methods failed
                ext.outputChannel.error(
                    l10n.t('Failed to acquire token for {endpoint}: {errors}', {
                        endpoint,
                        errors: errors.join('; '),
                    }),
                );
                throw new Error(l10n.t('Failed to acquire token: {errors}', { errors: errors.join('; ') }));
            },
        };
    } else {
        throw Error(l10n.t('No credential available to create CosmosClient.'));
    }

    return new CosmosClient(merge(options ?? {}, commonProperties));
}

function normalizeCosmosScopes(scopes: string | string[]): string | string[] {
    if (!scopes) {
        return scopes;
    }

    return Array.isArray(scopes) ? scopes.map(normalizeCosmosScope) : normalizeCosmosScope(scopes);
}

function normalizeCosmosScope(scope: string): string {
    if (!scope) {
        return scope;
    }

    // Convert all test/internal endpoints to the standard production endpoint
    const fabricSuffix = '.cosmos.fabric.microsoft.com/.default';
    if (!scope.endsWith(fabricSuffix)) {
        return scope;
    }
    const prefix = scope.substring(0, scope.length - fabricSuffix.length);
    if (prefix.endsWith('dxt-sql') || prefix.endsWith('msit-sql') || prefix.endsWith('daily-sql')) {
        return 'https://cosmos.azure.com/.default';
    }

    return scope;
}
