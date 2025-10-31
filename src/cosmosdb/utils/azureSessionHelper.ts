/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getSessionFromVSCode } from '@microsoft/vscode-azext-azureauth';
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
