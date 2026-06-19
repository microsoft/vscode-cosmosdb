/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Credential extraction and authentication classification for {@link NoSqlContainerResourceItem}
 * nodes. The {@link AuthKind} value is what the terminal-reuse layer consults to decide whether
 * an already-running shell can host a new node.
 */
import { AuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { type CosmosDBEntraIdCredential, type CosmosDBManagedIdentityCredential } from '../cosmosdb/CosmosDBCredential';
import { getAccessTokenForVSCode } from '../cosmosdb/utils/azureSessionHelper';
import { ext } from '../extensionVariables';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';

/** Authentication mode used at launch — determines which env vars (if any) are baked into the process. */
export type AuthKind = 'emulator' | 'accountKey' | 'entraId' | 'managedIdentity' | 'none';

export function getCosmosDBShellCredential(node: NoSqlContainerResourceItem): string | undefined {
    const credential = node.model.accountInfo.credentials.find((c) => c.type === AuthenticationMethod.accountKey);
    return credential?.key;
}

export function getEntraIdCredential(node: NoSqlContainerResourceItem): CosmosDBEntraIdCredential | undefined {
    return node.model.accountInfo.credentials.find((c) => c.type === AuthenticationMethod.entraId);
}

export function getManagedIdentityCredential(
    node: NoSqlContainerResourceItem,
): CosmosDBManagedIdentityCredential | undefined {
    return node.model.accountInfo.credentials.find((c) => c.type === AuthenticationMethod.managedIdentity);
}

/**
 * Classifies the authentication mode required by a node. This determines which env vars
 * (if any) the shell process must have been launched with in order to authenticate.
 */
export function getNodeAuthKind(node: NoSqlContainerResourceItem): AuthKind {
    if (node.model.accountInfo.isEmulator) {
        return 'emulator';
    }
    if (getCosmosDBShellCredential(node)) {
        return 'accountKey';
    }
    if (getEntraIdCredential(node)) {
        return 'entraId';
    }
    if (getManagedIdentityCredential(node)) {
        return 'managedIdentity';
    }
    return 'none';
}

/**
 * Obtains an access token from VS Code's authentication session for the Cosmos DB endpoint.
 * Used as a fallback token via COSMOSDB_SHELL_TOKEN if VisualStudioCodeCredential fails in the shell.
 */
export async function getCosmosDBShellToken(
    entraCredential: CosmosDBEntraIdCredential,
    endpoint: string,
): Promise<string | undefined> {
    try {
        const endpointUrl = new URL(endpoint);
        const scope = `${endpointUrl.origin}${endpointUrl.pathname}.default`;
        const token = await getAccessTokenForVSCode(scope, entraCredential.tenantId, { createIfNone: false });
        return token?.token ?? undefined;
    } catch {
        ext.outputChannel.appendLine('Failed to obtain fallback access token for Cosmos DB Shell');
        return undefined;
    }
}
