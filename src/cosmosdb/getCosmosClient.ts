/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDefaultHttpClient, type PipelineRequest, type PipelineResponse } from '@azure/core-rest-pipeline';
import { CosmosClient, type CosmosClientOptions } from '@azure/cosmos';
import { ManagedIdentityCredential } from '@azure/identity';
import { appendExtensionUserAgent } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import { merge } from 'es-toolkit';
import * as https from 'https';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { type AccountInfo } from '../tree/cosmosdb/AccountInfo';
import { AuthenticationMethod, getPreferredAuthenticationMethod } from './AuthenticationMethod';
import { getCosmosDBKeyCredential, type CosmosDBCredential } from './CosmosDBCredential';
import { createCosmosHttpClient } from './createCosmosHttpClient';
import { isNoSqlQueryConnection, type NoSqlQueryConnection } from './NoSqlQueryConnection';
import { SilentCosmosAuthenticationError } from './SilentCosmosAuthenticationError';
import { type AccessToken, getAccessTokenForVSCode, getOidFromToken } from './utils/azureSessionHelper';

export type GetCosmosClientOptions = Partial<CosmosClientOptions> & {
    wwwAuthenticate?: string; // Optional challenge for EntraID authentication
    isLlmTool?: boolean;
    silentAuthentication?: boolean;
    onAuthenticationMethod?: (method: CosmosDBCredential['type'], principalId?: string) => void;
    onAuthenticationAttempt?: (
        method: CosmosDBCredential['type'],
        outcome: 'succeeded' | 'unavailable' | 'failed',
        identity?: 'default' | 'clientId',
    ) => void;
    onHttpRequest?: (request: PipelineRequest) => void;
    onHttpResponse?: (response: PipelineResponse) => void;
    onHttpError?: (request: PipelineRequest, error: unknown) => void;
    onProxyConfiguration?: (mode: unknown, configured: boolean, strictSSL: boolean) => void;
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
        const accountInfo = arg1;
        endpoint = accountInfo.endpoint;
        credentials = accountInfo.credentials;
        isEmulator = accountInfo.isEmulator;
        options = arg2 as GetCosmosClientOptions;
    }

    const enableEndpointDiscovery: boolean | undefined = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.enableEndpointDiscovery);
    const connectionPolicy = {
        enableEndpointDiscovery: enableEndpointDiscovery === undefined ? true : enableEndpointDiscovery,
    };

    const keyCred = getCosmosDBKeyCredential(credentials);

    const {
        isLlmTool = false,
        silentAuthentication = false,
        wwwAuthenticate,
        onAuthenticationMethod,
        onAuthenticationAttempt,
        onHttpRequest,
        onHttpResponse,
        onHttpError,
        onProxyConfiguration,
        httpClient: suppliedHttpClient,
        ...clientOptions
    } = options ?? {};
    const agent =
        clientOptions.agent ??
        (isEmulator && endpoint.startsWith('https:') ? new https.Agent({ rejectUnauthorized: false }) : undefined);
    const http = vscode.workspace.getConfiguration('http');
    const strictSSL = http.get('proxyStrictSSL') !== false;
    onProxyConfiguration?.(http.get('proxySupport'), !!http.get('proxy'), strictSSL);
    const httpClient = suppliedHttpClient ?? (agent ? undefined : createCosmosHttpClient(strictSSL));
    const observeTransport = onHttpRequest || onHttpResponse || onHttpError;
    const transport = httpClient ?? (observeTransport ? createDefaultHttpClient() : undefined);
    const commonProperties: CosmosClientOptions = {
        endpoint,
        userAgentSuffix: `${appendExtensionUserAgent()}${isLlmTool ? '/llm-tool' : ''}`,
        agent,
        connectionPolicy,
    };

    // we can only authenticate with CosmosDBKeyCredential or another at a time, we'll use the first one we find
    const nonKeyCredentials = credentials.filter((cred) => cred.type !== AuthenticationMethod.accountKey);

    // @todo: Add telemetry to monitor usage of each credential type
    if (keyCred) {
        commonProperties.key = keyCred?.key;
        onAuthenticationMethod?.(keyCred.type);
    } else if (nonKeyCredentials.length > 0) {
        commonProperties.aadCredentials = {
            getToken: async (scopes, tokenOptions) => {
                // Fix scopes for test environments
                const normalizedAuthScopes = normalizeCosmosScopes(scopes);

                // Track errors for better diagnostics
                const errors: string[] = [];

                async function tryCredential(
                    credential: CosmosDBCredential,
                    forcePrompt: boolean,
                ): Promise<AccessToken | null> {
                    let token: AccessToken | null;
                    const identity =
                        credential.type === AuthenticationMethod.managedIdentity
                            ? credential.clientId
                                ? 'clientId'
                                : 'default'
                            : undefined;
                    try {
                        switch (credential.type) {
                            case AuthenticationMethod.accountKey:
                                // Account key should have been handled earlier and is not supported for AAD
                                return null;

                            case AuthenticationMethod.entraId: {
                                token = await getAccessTokenForVSCode(
                                    wwwAuthenticate
                                        ? { scopes: normalizedAuthScopes, wwwAuthenticate }
                                        : normalizedAuthScopes,
                                    credential.tenantId,
                                    silentAuthentication ? { silent: true } : { createIfNone: forcePrompt },
                                );
                                break;
                            }

                            case AuthenticationMethod.managedIdentity: {
                                const { clientId } = credential;
                                const auth = new ManagedIdentityCredential({ clientId });
                                token = await auth.getToken(normalizedAuthScopes, tokenOptions);
                                break;
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
                        onAuthenticationAttempt?.(
                            credential.type,
                            e instanceof Error && e.name === 'CredentialUnavailableError' ? 'unavailable' : 'failed',
                            identity,
                        );
                        if (silentAuthentication) return null;
                        const message = l10n.t('{type} auth failed: {error}', {
                            type: credential.type,
                            error: e instanceof Error ? e.message : String(e),
                        });
                        errors.push(message);
                        return null;
                    }
                    onAuthenticationAttempt?.(credential.type, token ? 'succeeded' : 'unavailable', identity);
                    if (token) onAuthenticationMethod?.(credential.type, getOidFromToken(token.token));
                    return token;
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

                if (silentAuthentication) {
                    throw new SilentCosmosAuthenticationError();
                }

                // 3. Last resort - Try EntraID again with forced prompting
                const entraIdCreds = credentials.filter((cred) => cred.type === AuthenticationMethod.entraId);

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

    return new CosmosClient({
        ...merge(clientOptions, commonProperties),
        // Wrap the SDK's HTTP transport only when diagnostics needs to observe it. Record the request before sending
        // so a connection failure without a response can still be tied to an SDK operation. Observe the HTTP status
        // and Cosmos DB substatus on response without changing the underlying transport or its proxy settings.
        httpClient:
            observeTransport && transport
                ? {
                      async sendRequest(request) {
                          onHttpRequest?.(request);
                          const response = await transport.sendRequest(request).catch((error: unknown) => {
                              onHttpError?.(request, error);
                              throw error;
                          });
                          onHttpResponse?.(response);
                          return response;
                      },
                  }
                : transport,
    });
}

function normalizeCosmosScopes(scopes: string | string[]): string[] {
    if (!Array.isArray(scopes)) {
        scopes = [scopes];
    }

    return scopes.map(normalizeCosmosScope);
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
