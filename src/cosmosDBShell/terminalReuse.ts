/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Tracks per-terminal launch state so we know which Cosmos DB Shell terminals can be reused
 * for a given node. The state describes how the process was *launched* (endpoint + auth
 * mode + env vars baked in), not its current in-shell connection status: a user may have
 * run `disconnect` inside the shell, which VS Code cannot observe. The reuse path therefore
 * always re-issues `connect` before sending further commands.
 */
import * as vscode from 'vscode';
import { type NoSqlContainerResourceItem } from '../tree/nosql/NoSqlContainerResourceItem';
import { type AuthKind, getEntraIdCredential, getManagedIdentityCredential, getNodeAuthKind } from './nodeCredentials';
import { quoteArg } from './shellCommand';

export type ShellTerminalState = {
    /** Endpoint the shell process was launched against, or '' for command-palette launches without a node. */
    endpoint: string;
    /** Authentication mode used at launch. Determines which env vars (if any) are baked into the process. */
    authKind: AuthKind;
    tenantId?: string;
    managedIdentityClientId?: string;
};

export const terminalStates = new Map<vscode.Terminal, ShellTerminalState>();

/** Builds a {@link ShellTerminalState} record describing how a shell would be launched for this node. */
export function buildTerminalStateForNode(node: NoSqlContainerResourceItem): ShellTerminalState {
    return {
        endpoint: node.model.accountInfo.endpoint ?? '',
        authKind: getNodeAuthKind(node),
        tenantId: getEntraIdCredential(node)?.tenantId,
        managedIdentityClientId: getManagedIdentityCredential(node)?.clientId,
    };
}

/**
 * Determines whether an already-running Cosmos DB Shell terminal can host the given node.
 *
 * Auth modes that need launch-time env vars (account key, Entra ID fallback token) are only
 * compatible if the terminal was launched for the *same endpoint* with the *same* auth mode
 * (and tenant for Entra ID) — otherwise the baked-in env would be wrong for the new node.
 * Auth modes that don't rely on env vars (emulator, managed identity, none) can run in any
 * tracked terminal via the interactive `connect` command.
 */
export function canReuseTerminalForNode(state: ShellTerminalState, node: NoSqlContainerResourceItem): boolean {
    const nodeAuth = getNodeAuthKind(node);

    if (nodeAuth === 'emulator' || nodeAuth === 'managedIdentity' || nodeAuth === 'none') {
        return true;
    }

    if (state.endpoint !== node.model.accountInfo.endpoint || state.authKind !== nodeAuth) {
        return false;
    }

    if (nodeAuth === 'entraId') {
        const cred = getEntraIdCredential(node);
        if (cred?.tenantId !== state.tenantId) {
            return false;
        }
    }

    return true;
}

/**
 * Finds the best tracked Cosmos DB Shell terminal to reuse for the given node, preferring
 * terminals already associated with the same endpoint to keep terminal usage stable.
 */
export function findReusableTerminalForNode(
    node: NoSqlContainerResourceItem,
): { terminal: vscode.Terminal; state: ShellTerminalState } | undefined {
    const candidates: Array<{ terminal: vscode.Terminal; state: ShellTerminalState; sameEndpoint: boolean }> = [];
    for (const [terminal, state] of terminalStates) {
        if (!vscode.window.terminals.includes(terminal)) {
            continue;
        }
        if (!canReuseTerminalForNode(state, node)) {
            continue;
        }
        candidates.push({
            terminal,
            state,
            sameEndpoint: state.endpoint === node.model.accountInfo.endpoint,
        });
    }
    candidates.sort((a, b) => Number(b.sameEndpoint) - Number(a.sameEndpoint));
    return candidates[0];
}

/**
 * Builds the interactive `connect` command that mirrors the CLI `--connect` flag and related
 * credential flags, so an already-running Cosmos DB Shell can be attached to a specific account.
 */
export function buildInteractiveConnectCommand(node: NoSqlContainerResourceItem, endpoint: string): string {
    const parts = ['connect', quoteArg(endpoint)];

    if (!node.model.accountInfo.isEmulator) {
        const entraCredential = getEntraIdCredential(node);
        if (entraCredential) {
            parts.push('--vscode-credential');
            if (entraCredential.tenantId) {
                parts.push('--tenant', quoteArg(entraCredential.tenantId));
            }
        }

        const managedIdentityCredential = getManagedIdentityCredential(node);
        if (managedIdentityCredential?.clientId) {
            parts.push('--managed-identity', quoteArg(managedIdentityCredential.clientId));
        }
    }

    return parts.join(' ');
}
