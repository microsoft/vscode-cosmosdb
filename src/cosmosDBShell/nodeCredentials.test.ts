/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { type CosmosDBCredential } from '../cosmosdb/CosmosDBCredential';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';
import {
    getCosmosDBShellCredential,
    getEntraIdCredential,
    getManagedIdentityCredential,
    getNodeAuthKind,
} from './nodeCredentials';

vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: vi.fn(),
        },
    },
}));

// azureSessionHelper transitively requires @microsoft/vscode-azext-azureauth, which uses
// CJS `require('vscode')` that bypasses the vitest alias for `vscode`. Mock it out — these
// tests only exercise the synchronous credential getters / classifier, not the token path.
vi.mock('../cosmosdb/utils/azureSessionHelper', () => ({
    getAccessTokenForVSCode: vi.fn(),
}));

type MakeNodeOptions = {
    endpoint?: string;
    isEmulator?: boolean;
    credentials?: CosmosDBCredential[];
};

function makeNode(opts: MakeNodeOptions = {}): NoSqlContainerResourceItem {
    return {
        model: {
            accountInfo: {
                endpoint: opts.endpoint ?? 'https://acct.documents.azure.com:443/',
                isEmulator: opts.isEmulator ?? false,
                credentials: opts.credentials ?? [],
            },
        },
    } as unknown as NoSqlContainerResourceItem;
}

describe('nodeCredentials.getNodeAuthKind', () => {
    it('returns "emulator" when isEmulator is true, regardless of credentials', () => {
        expect(getNodeAuthKind(makeNode({ isEmulator: true }))).toBe('emulator');
        expect(
            getNodeAuthKind(
                makeNode({
                    isEmulator: true,
                    credentials: [{ type: AuthenticationMethod.accountKey, key: 'k' }],
                }),
            ),
        ).toBe('emulator');
    });

    it('returns "accountKey" when an account-key credential exists', () => {
        expect(getNodeAuthKind(makeNode({ credentials: [{ type: AuthenticationMethod.accountKey, key: 'k' }] }))).toBe(
            'accountKey',
        );
    });

    it('prefers accountKey over entraId when both are present', () => {
        expect(
            getNodeAuthKind(
                makeNode({
                    credentials: [
                        { type: AuthenticationMethod.entraId, tenantId: 't' },
                        { type: AuthenticationMethod.accountKey, key: 'k' },
                    ],
                }),
            ),
        ).toBe('accountKey');
    });

    it('returns "entraId" when only an entra credential exists', () => {
        expect(
            getNodeAuthKind(makeNode({ credentials: [{ type: AuthenticationMethod.entraId, tenantId: 't' }] })),
        ).toBe('entraId');
    });

    it('prefers entraId over managedIdentity when both are present (and no account key)', () => {
        expect(
            getNodeAuthKind(
                makeNode({
                    credentials: [
                        { type: AuthenticationMethod.managedIdentity, clientId: 'c' },
                        { type: AuthenticationMethod.entraId, tenantId: 't' },
                    ],
                }),
            ),
        ).toBe('entraId');
    });

    it('returns "managedIdentity" when only a managed-identity credential exists', () => {
        expect(
            getNodeAuthKind(
                makeNode({
                    credentials: [{ type: AuthenticationMethod.managedIdentity, clientId: 'c' }],
                }),
            ),
        ).toBe('managedIdentity');
    });

    it('returns "none" when the credentials list is empty', () => {
        expect(getNodeAuthKind(makeNode({}))).toBe('none');
    });
});

describe('nodeCredentials credential getters', () => {
    it('getCosmosDBShellCredential returns the key for the first account-key credential', () => {
        expect(
            getCosmosDBShellCredential(
                makeNode({ credentials: [{ type: AuthenticationMethod.accountKey, key: 'KEY' }] }),
            ),
        ).toBe('KEY');
    });

    it('getCosmosDBShellCredential returns undefined when no account-key credential is present', () => {
        expect(
            getCosmosDBShellCredential(
                makeNode({ credentials: [{ type: AuthenticationMethod.entraId, tenantId: 't' }] }),
            ),
        ).toBeUndefined();
    });

    it('getEntraIdCredential returns the entra credential object', () => {
        const cred: CosmosDBCredential = { type: AuthenticationMethod.entraId, tenantId: 'TENANT' };
        expect(getEntraIdCredential(makeNode({ credentials: [cred] }))).toBe(cred);
    });

    it('getEntraIdCredential returns undefined when no entra credential is present', () => {
        expect(getEntraIdCredential(makeNode({}))).toBeUndefined();
    });

    it('getManagedIdentityCredential returns the managed-identity credential object', () => {
        const cred: CosmosDBCredential = {
            type: AuthenticationMethod.managedIdentity,
            clientId: 'CID',
        };
        expect(getManagedIdentityCredential(makeNode({ credentials: [cred] }))).toBe(cred);
    });

    it('getManagedIdentityCredential returns undefined when no managed-identity credential is present', () => {
        expect(getManagedIdentityCredential(makeNode({}))).toBeUndefined();
    });
});
