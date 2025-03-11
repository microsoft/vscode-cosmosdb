/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CosmosClient, type CosmosClientOptions } from '@azure/cosmos';
import * as l10n from '@vscode/l10n';
// eslint-disable-next-line import/no-internal-modules
import { getSessionFromVSCode } from '@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode';
import { appendExtensionUserAgent } from '@microsoft/vscode-azext-utils';
import * as https from 'https';
import { merge } from 'lodash';
import * as vscode from 'vscode';
import { ext } from '../extensionVariables';
import { type NoSqlQueryConnection } from './NoSqlCodeLensProvider';

export enum AuthenticationMethod {
    auto = 'auto',
    accountKey = 'accountKey',
    entraId = 'entraId',
}

export type CosmosDBKeyCredential = {
    type: AuthenticationMethod.accountKey;
    key: string;
};

export type CosmosDBAuthCredential = {
    type: AuthenticationMethod.entraId;
    tenantId: string | undefined;
};

export type CosmosDBCredential = CosmosDBKeyCredential | CosmosDBAuthCredential;

export function getCosmosKeyCredential(credentials: CosmosDBCredential[]): CosmosDBKeyCredential | undefined {
    return credentials.filter(
        (cred): cred is CosmosDBKeyCredential => cred.type === AuthenticationMethod.accountKey,
    )[0];
}

export function getCosmosAuthCredential(credentials: CosmosDBCredential[]): CosmosDBAuthCredential | undefined {
    return credentials.filter((cred): cred is CosmosDBAuthCredential => cred.type === AuthenticationMethod.entraId)[0];
}

export function getCosmosClientByConnection(
    connection: NoSqlQueryConnection,
    options?: Partial<CosmosClientOptions>,
): CosmosClient {
    const { endpoint, masterKey, isEmulator, tenantId } = connection;

    const vscodeStrictSSL: boolean | undefined = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.vsCode.proxyStrictSSL);
    const enableEndpointDiscovery: boolean | undefined = vscode.workspace
        .getConfiguration()
        .get<boolean>(ext.settingsKeys.enableEndpointDiscovery);
    const connectionPolicy = {
        enableEndpointDiscovery: enableEndpointDiscovery === undefined ? true : enableEndpointDiscovery,
    };
    const agent = endpoint.startsWith('https:')
        ? new https.Agent({ rejectUnauthorized: isEmulator ? !isEmulator : vscodeStrictSSL })
        : undefined;
    const commonProperties: CosmosClientOptions = {
        endpoint,
        userAgentSuffix: appendExtensionUserAgent(),
        agent: agent,
        connectionPolicy,
    };

    if (masterKey !== undefined) {
        commonProperties.key = masterKey;
    } else {
        commonProperties.aadCredentials = {
            getToken: async (scopes, _options) => {
                const session = await getSessionFromVSCode(scopes, tenantId, { createIfNone: true });
                return {
                    token: session?.accessToken ?? '',
                    expiresOnTimestamp: 0,
                };
            },
        };
    }

    return new CosmosClient(merge(options ?? {}, commonProperties));
}

export function getCosmosClient(
    endpoint: string,
    credentials: CosmosDBCredential[],
    isEmulator: boolean,
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
    const authCred = getCosmosAuthCredential(credentials);

    const agent = endpoint.startsWith('https:')
        ? new https.Agent({ rejectUnauthorized: isEmulator ? !isEmulator : vscodeStrictSSL })
        : undefined;
    const commonProperties = {
        endpoint,
        userAgentSuffix: appendExtensionUserAgent(),
        agent: agent,
        connectionPolicy,
    };
    // @todo: Add telemetry to monitor usage of each credential type
    if (keyCred) {
        return new CosmosClient({
            ...commonProperties,
            key: keyCred.key,
        });
    } else if (authCred) {
        return new CosmosClient({
            ...commonProperties,
            aadCredentials: {
                getToken: async (scopes, _options) => {
                    const session = await getSessionFromVSCode(scopes, authCred.tenantId, { createIfNone: true });
                    return {
                        token: session?.accessToken ?? '',
                        expiresOnTimestamp: 0,
                    };
                },
            },
        });
    } else {
        throw Error(l10n.t('No credential available to create CosmosClient.'));
    }
}
