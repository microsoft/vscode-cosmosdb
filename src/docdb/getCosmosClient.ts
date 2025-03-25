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
import { getPreferredAuthenticationMethod } from '../tree/docdb/AccountInfo';
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
                    // TODO: VS Code session tokens have no expiration time, should we limit this to 1h?
                    expiresOnTimestamp: 0,
                });

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
                                const { tenantId } = credential as CosmosDBEntraIdCredential;
                                const session = await getSessionFromVSCode(scopes, tenantId, {
                                    createIfNone: forcePrompt,
                                });
                                return session?.accessToken ? formatToken(session.accessToken) : null;
                            }

                            case AuthenticationMethod.managedIdentity: {
                                const { clientId } = credential as CosmosDBManagedIdentityCredential;
                                const auth = new ManagedIdentityCredential({ clientId });
                                return await auth.getToken(scopes);
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
