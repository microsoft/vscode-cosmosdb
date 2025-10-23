/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-internal-modules
import { getSessionFromVSCode } from '@microsoft/vscode-azext-azureauth/out/src/getSessionFromVSCode';
import type * as vscode from 'vscode';

export async function getSignedInPrincipalIdForAccountEndpoint(
    accountEndpoint: string,
    tenantId: string | undefined,
): Promise<string | undefined> {
    const session = await getSessionForDatabaseAccount(accountEndpoint, tenantId);
    return session?.account.id.split('/')[1] ?? session?.account.id;
}

async function getSessionForDatabaseAccount(
    endpoint: string,
    tenantId: string | undefined,
): Promise<vscode.AuthenticationSession | undefined> {
    const endpointUrl = new URL(endpoint);
    const scope = `${endpointUrl.origin}${endpointUrl.pathname}.default`;
    return await getSessionFromVSCode(scope, tenantId, { createIfNone: false });
}

export type AccessToken = { token: string; expiresOnTimestamp: number };

export async function getAccessTokenForVSCode(
     
    scopes: vscode.AuthenticationWWWAuthenticateRequest | string[] | string,
    tenantId: string | undefined,
    options?: vscode.AuthenticationGetSessionOptions,
): Promise<AccessToken | null> {
    const session = await getSessionFromVSCode(scopes, tenantId, options);

    return session?.accessToken
        ? {
              token: session.accessToken,
              // TODO: VS Code session tokens have no expiration time, should we limit this to 1h?
              expiresOnTimestamp: 0,
          }
        : null;
}
