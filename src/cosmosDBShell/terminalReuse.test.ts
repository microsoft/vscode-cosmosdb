/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, vi } from 'vitest';
import { AuthenticationMethod } from '../cosmosdb/AuthenticationMethod';
import { type CosmosDBCredential } from '../cosmosdb/CosmosDBCredential';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';
import {
    buildInteractiveConnectCommand,
    buildTerminalStateForNode,
    canReuseTerminalForNode,
    type ShellTerminalState,
} from './terminalReuse';

vi.mock('../extensionVariables', () => ({
    ext: {
        outputChannel: {
            appendLine: vi.fn(),
        },
    },
}));

// nodeCredentials transitively loads @microsoft/vscode-azext-azureauth, which uses CJS
// `require('vscode')` that bypasses the vitest alias. Stub it for module load.
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

describe('terminalReuse.buildTerminalStateForNode', () => {
    it('captures endpoint, auth kind, tenant, and managed-identity client id', () => {
        const node = makeNode({
            endpoint: 'https://x/',
            credentials: [
                { type: AuthenticationMethod.entraId, tenantId: 'T1' },
                { type: AuthenticationMethod.managedIdentity, clientId: 'MI1' },
            ],
        });
        expect(buildTerminalStateForNode(node)).toEqual({
            endpoint: 'https://x/',
            authKind: 'entraId',
            tenantId: 'T1',
            managedIdentityClientId: 'MI1',
        });
    });

    it('defaults endpoint to "" when accountInfo.endpoint is undefined', () => {
        const node = {
            model: { accountInfo: { credentials: [], isEmulator: false } },
        } as unknown as NoSqlContainerResourceItem;
        expect(buildTerminalStateForNode(node).endpoint).toBe('');
    });

    it('reports authKind = "accountKey" when an account key is present', () => {
        const node = makeNode({
            credentials: [{ type: AuthenticationMethod.accountKey, key: 'k' }],
        });
        expect(buildTerminalStateForNode(node).authKind).toBe('accountKey');
    });

    it('reports authKind = "emulator" when the node is an emulator', () => {
        expect(buildTerminalStateForNode(makeNode({ isEmulator: true })).authKind).toBe('emulator');
    });

    it('reports authKind = "none" when no credentials are present', () => {
        const state = buildTerminalStateForNode(makeNode({}));
        expect(state.authKind).toBe('none');
        expect(state.tenantId).toBeUndefined();
        expect(state.managedIdentityClientId).toBeUndefined();
    });
});

describe('terminalReuse.canReuseTerminalForNode', () => {
    const accountKeyTerminal: ShellTerminalState = {
        endpoint: 'https://acct/',
        authKind: 'accountKey',
    };

    it('allows reuse for emulator nodes regardless of terminal state', () => {
        expect(canReuseTerminalForNode(accountKeyTerminal, makeNode({ isEmulator: true }))).toBe(true);
    });

    it('allows reuse for managed-identity nodes regardless of terminal state', () => {
        expect(
            canReuseTerminalForNode(
                accountKeyTerminal,
                makeNode({
                    credentials: [{ type: AuthenticationMethod.managedIdentity, clientId: 'mi' }],
                }),
            ),
        ).toBe(true);
    });

    it('allows reuse for "none" auth nodes regardless of terminal state', () => {
        expect(canReuseTerminalForNode(accountKeyTerminal, makeNode({}))).toBe(true);
    });

    it('rejects reuse when account-key node endpoint differs from terminal endpoint', () => {
        expect(
            canReuseTerminalForNode(
                { endpoint: 'https://a/', authKind: 'accountKey' },
                makeNode({
                    endpoint: 'https://b/',
                    credentials: [{ type: AuthenticationMethod.accountKey, key: 'k' }],
                }),
            ),
        ).toBe(false);
    });

    it('rejects reuse when account-key node matches endpoint but terminal authKind differs', () => {
        expect(
            canReuseTerminalForNode(
                { endpoint: 'https://a/', authKind: 'entraId' },
                makeNode({
                    endpoint: 'https://a/',
                    credentials: [{ type: AuthenticationMethod.accountKey, key: 'k' }],
                }),
            ),
        ).toBe(false);
    });

    it('allows reuse for account-key node when endpoint and authKind match', () => {
        expect(
            canReuseTerminalForNode(
                { endpoint: 'https://a/', authKind: 'accountKey' },
                makeNode({
                    endpoint: 'https://a/',
                    credentials: [{ type: AuthenticationMethod.accountKey, key: 'k' }],
                }),
            ),
        ).toBe(true);
    });

    it('rejects reuse for entra node when tenant differs from terminal tenant', () => {
        expect(
            canReuseTerminalForNode(
                { endpoint: 'https://a/', authKind: 'entraId', tenantId: 'T1' },
                makeNode({
                    endpoint: 'https://a/',
                    credentials: [{ type: AuthenticationMethod.entraId, tenantId: 'T2' }],
                }),
            ),
        ).toBe(false);
    });

    it('allows reuse for entra node when endpoint and tenant match', () => {
        expect(
            canReuseTerminalForNode(
                { endpoint: 'https://a/', authKind: 'entraId', tenantId: 'T1' },
                makeNode({
                    endpoint: 'https://a/',
                    credentials: [{ type: AuthenticationMethod.entraId, tenantId: 'T1' }],
                }),
            ),
        ).toBe(true);
    });
});

describe('terminalReuse.buildInteractiveConnectCommand', () => {
    it('emits a plain connect for emulator nodes (no credential flags)', () => {
        const node = makeNode({
            isEmulator: true,
            endpoint: 'https://emu:8081/',
            credentials: [{ type: AuthenticationMethod.entraId, tenantId: 'T' }],
        });
        expect(buildInteractiveConnectCommand(node, 'https://emu:8081/')).toBe('connect https://emu:8081/');
    });

    it('appends --vscode-credential and --tenant for entra nodes', () => {
        const node = makeNode({
            credentials: [{ type: AuthenticationMethod.entraId, tenantId: 'TENANT' }],
        });
        expect(buildInteractiveConnectCommand(node, 'https://a/')).toBe(
            'connect https://a/ --vscode-credential --tenant TENANT',
        );
    });

    it('appends --vscode-credential without --tenant when no tenantId is set on the entra credential', () => {
        const node = makeNode({
            credentials: [{ type: AuthenticationMethod.entraId, tenantId: undefined }],
        });
        expect(buildInteractiveConnectCommand(node, 'https://a/')).toBe('connect https://a/ --vscode-credential');
    });

    it('appends --managed-identity with the client id for managed-identity nodes', () => {
        const node = makeNode({
            credentials: [{ type: AuthenticationMethod.managedIdentity, clientId: 'MI-CID' }],
        });
        expect(buildInteractiveConnectCommand(node, 'https://a/')).toBe('connect https://a/ --managed-identity MI-CID');
    });

    it('omits --managed-identity when the managed-identity credential has no clientId', () => {
        const node = makeNode({
            credentials: [{ type: AuthenticationMethod.managedIdentity, clientId: undefined }],
        });
        expect(buildInteractiveConnectCommand(node, 'https://a/')).toBe('connect https://a/');
    });

    it('quotes endpoints containing spaces or quotes', () => {
        const node = makeNode({});
        expect(buildInteractiveConnectCommand(node, 'https://a b/')).toBe('connect "https://a b/"');
    });

    it('quotes tenant ids containing spaces', () => {
        const node = makeNode({
            credentials: [{ type: AuthenticationMethod.entraId, tenantId: 'a b' }],
        });
        expect(buildInteractiveConnectCommand(node, 'https://a/')).toBe(
            'connect https://a/ --vscode-credential --tenant "a b"',
        );
    });

    it('emits both --vscode-credential and --managed-identity when both credentials are present', () => {
        const node = makeNode({
            credentials: [
                { type: AuthenticationMethod.entraId, tenantId: 'T' },
                { type: AuthenticationMethod.managedIdentity, clientId: 'MI' },
            ],
        });
        expect(buildInteractiveConnectCommand(node, 'https://a/')).toBe(
            'connect https://a/ --vscode-credential --tenant T --managed-identity MI',
        );
    });
});
