/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, type CosmosClientOptions } from '@azure/cosmos';
import { ManagedIdentityCredential } from '@azure/identity';
// eslint-disable-next-line import/no-internal-modules
import { getSessionFromVSCode } from '@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode';
import { appendExtensionUserAgent } from '@microsoft/vscode-azext-utils';
import * as https from 'https';
import { merge } from 'lodash';
import * as vscode from 'vscode';
import { l10n } from 'vscode';
import { ext } from '../extensionVariables';
import { type NoSqlQueryConnection } from './NoSqlCodeLensProvider';

export enum AuthenticationMethod {
    auto = 'auto',
    accountKey = 'accountKey',
    entraId = 'entraId',
    managedIdentity = 'managedIdentity',
}

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

export function getCosmosKeyCredential(credentials: CosmosDBCredential[]): CosmosDBKeyCredential | undefined {
    return credentials.filter(
        (cred): cred is CosmosDBKeyCredential => cred.type === AuthenticationMethod.accountKey,
    )[0];
}

export function getCosmosEntraIdCredential(credentials: CosmosDBCredential[]): CosmosDBEntraIdCredential | undefined {
    return credentials.filter(
        (cred): cred is CosmosDBEntraIdCredential => cred.type === AuthenticationMethod.entraId,
    )[0];
}

export function getCosmosClientByConnection(
    connection: NoSqlQueryConnection,
    options?: Partial<CosmosClientOptions>,
): CosmosClient {
    return getCosmosClient(connection.endpoint, connection.credentials, connection.isEmulator, options);
}

export function getCosmosClient(
    endpoint: string,
    credentials: CosmosDBCredential[],
    isEmulator: boolean,
    options?: Partial<CosmosClientOptions>,
): CosmosClient {
    const vscodeStrictSSL: boolean | undefined = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    const enableEndpointDiscovery: boolean | undefined = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.enableEndpointDiscovery);
    const connectionPolicy = {
        enableEndpointDiscovery: enableEndpointDiscovery === undefined ? true : enableEndpointDiscovery,
    };

    const keyCred = getCosmosKeyCredential(credentials);

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
                // Track errors for better diagnostics
                const errors: string[] = [];

                // Create reusable handler for token response formatting
                const formatToken = (accessToken: string): { token: string; expiresOnTimestamp: number } => ({
                    token: accessToken,
                    expiresOnTimestamp: 0,
                });

                if (nonKeyCredentials.length === 0) {
                    throw new Error(l10n.t('No valid credential found for token acquisition'));
                }

                async function tryCredential(
                    credential: CosmosDBCredential,
                    isPreferred: boolean,
                ): Promise<{ token: string; expiresOnTimestamp: number } | null> {
                    try {
                        switch (credential.type) {
                            case AuthenticationMethod.entraId: {
                                const cred = credential as CosmosDBEntraIdCredential;
                                const session = await getSessionFromVSCode(scopes, cred.tenantId, {
                                    createIfNone: isPreferred,
                                });
                                return session?.accessToken ? formatToken(session.accessToken) : null;
                            }

                            case AuthenticationMethod.managedIdentity: {
                                const cred = credential as CosmosDBManagedIdentityCredential;
                                const auth = new ManagedIdentityCredential({ clientId: cred.clientId });
                                return await auth.getToken(scopes);
                            }

                            default:
                                // Handle future credential types
                                errors.push(`Unsupported credential type: ${credential.type}`);
                                return null;
                        }
                    } catch (e) {
                        const message = `${credential.type} auth failed: ${e instanceof Error ? e.message : String(e)}`;
                        errors.push(message);
                        return null;
                    }
                }

                // THREE-STEP AUTHENTICATION STRATEGY:

                // 1. Try preferred credential first (with prompting for EntraID)
                const preferredResult = await tryCredential(nonKeyCredentials[0], true);
                if (preferredResult) return preferredResult;

                // 2. Try remaining credentials without prompting
                for (let i = 1; i < nonKeyCredentials.length; i++) {
                    const result = await tryCredential(nonKeyCredentials[i], false);
                    if (result) return result;
                }

                // 3. Last resort - Try EntraID again with forced prompting
                const entraIdCreds = nonKeyCredentials.filter(
                    (cred) => cred.type === AuthenticationMethod.entraId,
                ) as CosmosDBEntraIdCredential[];

                if (entraIdCreds.length > 0) {
                    // Force prompt on Entra ID as last resort
                    const session = await getSessionFromVSCode(scopes, entraIdCreds[0].tenantId, {
                        createIfNone: true,
                    });

                    if (session?.accessToken) {
                        return formatToken(session.accessToken);
                    }

                    errors.push(l10n.t('Last-resort interactive EntraID authentication failed'));
                }

                // All methods failed
                ext.outputChannel.error(
                    l10n.t('Failed to acquire token for {endpoint}: ${errors}', {
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
