/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getSessionFromVSCode } from '@microsoft/vscode-azext-azureauth';
import { type AzureSubscription } from '@microsoft/vscode-azureresources-api';
import type * as vscode from 'vscode';

export async function getSignedInPrincipalIdForAccountEndpoint(
    accountEndpoint: string,
    tenantId: string | undefined,
): Promise<string | undefined> {
    const session = await getSessionForDatabaseAccount(accountEndpoint, tenantId);
    if (!session) return undefined;

    // The access token's `oid` claim gives the correct principal ID for the tenant
    // the token was issued for, unlike session.account.id which is always the home tenant identity.
    const oid = getOidFromToken(session.accessToken);
    if (oid) return oid;

    // Fallback to account.id parsing if token decoding fails
    const rawId = session.account.id;
    if (!rawId) return undefined;
    return rawId.split(/[./]/)[0];
}

/**
 * Gets the signed-in user's principal ID (object ID) for a given subscription.
 * Uses the subscription's authentication session which is already scoped to the correct tenant.
 * Decodes the access token to get the `oid` claim, which reflects the user's identity
 * in the target tenant (important for guest users in multi-tenant scenarios).
 */
export async function getSignedInPrincipalIdForSubscription(
    subscription: AzureSubscription,
): Promise<string | undefined> {
    const session = await subscription.authentication.getSession();
    if (!session) return undefined;

    // The access token's `oid` claim gives the correct principal ID for the tenant
    // the token was issued for, unlike session.account.id which is always the home tenant identity.
    const oid = getOidFromToken(session.accessToken);
    if (oid) return oid;

    // Fallback to account.id parsing if token decoding fails
    const rawId = session.account.id;
    if (!rawId) return undefined;
    return rawId.split(/[./]/)[0];
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

/**
 * Extracts the `oid` (object ID) claim from a JWT access token.
 * This gives the user's principal ID in the tenant the token was issued for.
 */
function getOidFromToken(accessToken: string): string | undefined {
    try {
        const parts = accessToken.split('.');
        if (parts.length !== 3) return undefined;
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as { oid?: string };
        return payload.oid;
    } catch {
        return undefined;
    }
}
