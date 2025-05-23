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
    const principalId = session?.account.id.split('/')[1] ?? session?.account.id;
    return principalId;
}

async function getSessionForDatabaseAccount(
    endpoint: string,
    tenantId: string | undefined,
): Promise<vscode.AuthenticationSession | undefined> {
    const endpointUrl = new URL(endpoint);
    const scrope = `${endpointUrl.origin}${endpointUrl.pathname}.default`;
    return await getSessionFromVSCode(scrope, tenantId, { createIfNone: false });
}
