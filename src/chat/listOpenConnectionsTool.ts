/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseError } from '@microsoft/vscode-azext-utils';
import * as l10n from '@vscode/l10n';
import * as vscode from 'vscode';
import { type NoSqlQueryConnection } from '../cosmosdb/NoSqlQueryConnection';
import { ext } from '../extensionVariables';
import { QueryEditorTab } from '../panels/QueryEditorTab';
import { getActiveQueryEditor, getConnectionFromQueryTab } from './chatUtils';
import { revealConnectionInTree } from './revealConnection';

/**
 * Tool name constant for the list-open-connections tool.
 * Keep in sync with the `name` in package.json `contributes.languageModelTools`.
 */
export const LIST_OPEN_CONNECTIONS_TOOL_NAME = 'cosmosdb_listOpenConnections';

/**
 * Tool description for the list-open-connections tool.
 * Keep in sync with the `modelDescription` in package.json `contributes.languageModelTools`.
 */
export const LIST_OPEN_CONNECTIONS_TOOL_DESCRIPTION =
    'Lists every open Cosmos DB Query Editor and the container each one is connected to (database, container, ' +
    'whether it is the emulator, whether it is the active/focused editor, and — for Azure-signed-in ' +
    'accounts — the account name, subscription, and resource group). Use this to discover existing connections and ' +
    'suggest the right container to the user instead of guessing or re-opening a new connection. To make one of ' +
    'these open editors the active one so the other Query Editor tools act on it, use cosmosdb_focusQueryEditor. ' +
    'Optionally set ' +
    'reveal=true to highlight a connection in the Azure Resources tree: it reveals the connection matching databaseId ' +
    "/ containerId when both are given, otherwise the active editor's connection. Revealing works only for " +
    'Azure-signed-in accounts (not workspace-attached accounts or the emulator). Returns PII-free metadata only — ' +
    'never query text or document data.';

/**
 * Input for the list-open-connections tool.
 */
interface ListOpenConnectionsInput {
    /**
     * When true, reveal a connection in the Azure Resources tree. Reveals the connection matching
     * {@link databaseId}/{@link containerId} when both are provided, otherwise the active editor's
     * connection.
     */
    reveal?: boolean;
    /** Database of the connection to reveal. Used together with {@link containerId}. */
    databaseId?: string;
    /** Container of the connection to reveal. Used together with {@link databaseId}. */
    containerId?: string;
}

/**
 * Tool input schema. All properties are optional.
 * Keep in sync with the `inputSchema` in package.json `contributes.languageModelTools`.
 */
export const LIST_OPEN_CONNECTIONS_TOOL_INPUT_SCHEMA = {
    type: 'object' as const,
    properties: {
        reveal: {
            type: 'boolean',
            description:
                'When true, reveal a connection in the Azure Resources tree (the one matching databaseId/containerId ' +
                'when both are given, otherwise the active editor connection).',
        },
        databaseId: {
            type: 'string',
            description: 'Database of the connection to reveal in the tree. Use together with containerId.',
        },
        containerId: {
            type: 'string',
            description: 'Container of the connection to reveal in the tree. Use together with databaseId.',
        },
    },
    additionalProperties: false,
};

/**
 * PII-free description of a single open Query Editor connection.
 */
interface OpenConnectionInfo {
    databaseId: string;
    containerId: string;
    isEmulator: boolean;
    /** True when this is the active (focused) Query Editor. */
    isActive: boolean;
    /** True when this Query Editor is visible (may be true for several split editors). */
    isVisible: boolean;
    /** True when this connection can be revealed in the Azure Resources tree (Azure-signed-in accounts only). */
    canRevealInTree: boolean;
    /** Azure resource coordinates; present only for Azure-signed-in accounts. */
    azure?: {
        accountName: string;
        subscriptionId: string;
        subscriptionName?: string;
        resourceGroup: string;
    };
}

/**
 * The PII-free result returned by the tool.
 */
interface ListOpenConnectionsResult {
    openConnectionCount: number;
    connections: OpenConnectionInfo[];
    /** The connection that was revealed in the tree, if reveal was requested and succeeded. */
    revealed?: { databaseId: string; containerId: string };
    /** A human-readable reason when reveal was requested but could not be performed. */
    revealError?: string;
}

/**
 * Builds the PII-free info object for a single tab/connection pair.
 */
export function toConnectionInfo(tab: QueryEditorTab, connection: NoSqlQueryConnection): OpenConnectionInfo {
    const azureMetadata = connection.azureMetadata;
    return {
        databaseId: connection.databaseId,
        containerId: connection.containerId,
        isEmulator: connection.isEmulator,
        isActive: tab.isActive(),
        isVisible: tab.isVisible(),
        canRevealInTree: !!azureMetadata,
        azure: azureMetadata
            ? {
                  accountName: azureMetadata.accountName,
                  subscriptionId: azureMetadata.subscription.subscriptionId,
                  subscriptionName: azureMetadata.subscription.name,
                  resourceGroup: azureMetadata.resourceGroup,
              }
            : undefined,
    };
}

/**
 * Collects the open Query Editor tabs paired with their connections (skipping tabs with no connection).
 */
function getOpenConnections(): { tab: QueryEditorTab; connection: NoSqlQueryConnection }[] {
    return Array.from(QueryEditorTab.openTabs)
        .map((tab) => ({ tab, connection: getConnectionFromQueryTab(tab) }))
        .filter((entry): entry is { tab: QueryEditorTab; connection: NoSqlQueryConnection } => !!entry.connection);
}

/**
 * Reveals a connection in the Azure Resources tree. Picks the target connection (the one matching
 * the requested databaseId/containerId, otherwise the active editor's), then delegates the actual
 * drill-down to the shared {@link revealConnectionInTree} helper. Only Azure-signed-in accounts can
 * be revealed; for workspace-attached accounts and the emulator there is no Azure resource id to
 * drill into. Returns the coordinates revealed, or an error message describing why reveal was not
 * possible.
 */
async function revealSelectedConnection(
    entries: { tab: QueryEditorTab; connection: NoSqlQueryConnection }[],
    input: ListOpenConnectionsInput,
): Promise<{ revealed?: { databaseId: string; containerId: string }; revealError?: string }> {
    if (entries.length === 0) {
        return { revealError: l10n.t('There are no open Query Editor connections to reveal.') };
    }

    // Pick the target: the connection matching databaseId/containerId when both are given,
    // otherwise the active editor's connection (falling back to the first open one).
    let target: { tab: QueryEditorTab; connection: NoSqlQueryConnection } | undefined;
    if (input.databaseId && input.containerId) {
        target = entries.find(
            (e) => e.connection.databaseId === input.databaseId && e.connection.containerId === input.containerId,
        );
        if (!target) {
            return {
                revealError: l10n.t(
                    'No open Query Editor is connected to database "{0}" / container "{1}".',
                    input.databaseId,
                    input.containerId,
                ),
            };
        }
    } else {
        const activeTab = getActiveQueryEditor(entries.map((e) => e.tab));
        target = entries.find((e) => e.tab === activeTab) ?? entries[0];
    }

    const { connection } = target;
    const { revealed, error } = await revealConnectionInTree(connection);
    if (!revealed) {
        return { revealError: error };
    }

    return { revealed: { databaseId: connection.databaseId, containerId: connection.containerId } };
}

/**
 * Registers the cosmosdb_listOpenConnections tool with the VS Code Language Model API.
 */
export function registerListOpenConnectionsTool(context: vscode.ExtensionContext): void {
    const tool = vscode.lm.registerTool<ListOpenConnectionsInput>(LIST_OPEN_CONNECTIONS_TOOL_NAME, {
        prepareInvocation(
            options: vscode.LanguageModelToolInvocationPrepareOptions<ListOpenConnectionsInput>,
            _token: vscode.CancellationToken,
        ): vscode.PreparedToolInvocation {
            return {
                invocationMessage: options.input?.reveal
                    ? l10n.t('Revealing the connection in the Azure Resources tree…')
                    : l10n.t('Listing open Cosmos DB connections…'),
            };
        },

        async invoke(
            options: vscode.LanguageModelToolInvocationOptions<ListOpenConnectionsInput>,
            token: vscode.CancellationToken,
        ): Promise<vscode.LanguageModelToolResult> {
            if (token.isCancellationRequested) {
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Operation cancelled.')),
                ]);
            }

            try {
                const entries = getOpenConnections();
                const result: ListOpenConnectionsResult = {
                    openConnectionCount: entries.length,
                    connections: entries.map((e) => toConnectionInfo(e.tab, e.connection)),
                };

                if (options.input?.reveal) {
                    const { revealed, revealError } = await revealSelectedConnection(entries, options.input);
                    if (revealed) {
                        result.revealed = revealed;
                        ext.outputChannel.info(
                            l10n.t(
                                '[List Open Connections Tool] Revealed {0}/{1} in the Azure Resources tree.',
                                revealed.databaseId,
                                revealed.containerId,
                            ),
                        );
                    }
                    if (revealError) {
                        result.revealError = revealError;
                    }
                }

                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(JSON.stringify(result, null, 2)),
                ]);
            } catch (error) {
                const message = parseError(error).message;
                ext.outputChannel.error(
                    l10n.t('[List Open Connections Tool] Failed to list open connections: {0}', message),
                );
                return new vscode.LanguageModelToolResult([
                    new vscode.LanguageModelTextPart(l10n.t('Failed to list open connections: {0}', message)),
                ]);
            }
        },
    });

    context.subscriptions.push(tool);
}
